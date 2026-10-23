package com.shopsmart.knowledge;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.shopsmart.ai.ProductEmbeddingService;
import com.shopsmart.ai.config.AiProperties;
import com.shopsmart.ai.config.NvidiaEmbeddingModel;
import com.shopsmart.common.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Upload → store → parse → chunk → embed → index → activate. Runs off the request thread; the
 * document row's status (UPLOADED, PROCESSING, READY, FAILED) is what the admin UI polls.
 */
@Service
public class IngestionService {

    private static final Logger log = LoggerFactory.getLogger(IngestionService.class);

    public static final Set<String> CATEGORIES = Set.of(
            "RETURN", "SHIPPING", "REFUND", "WARRANTY", "MEMBERSHIP", "MANUAL", "SELLER", "SLA", "CANCELLATION");
    public static final Set<String> TIERS = Set.of("BASIC", "PRIME", "PREMIUM");
    public static final Set<String> REGIONS = Set.of("GLOBAL", "IN-WEST", "IN-NORTH", "IN-SOUTH", "IN-EAST");
    static final long MAX_BYTES = 20L * 1024 * 1024;

    private final KnowledgeRepository repo;
    private final DocumentParser parser;
    private final Chunker chunker;
    private final NvidiaEmbeddingModel embeddings;
    private final AiProperties ai;
    private final Path storageDir;

    public IngestionService(KnowledgeRepository repo, DocumentParser parser, Chunker chunker, NvidiaEmbeddingModel embeddings,
                            AiProperties ai, @Value("${KNOWLEDGE_STORAGE_DIR:storage/knowledge}") String storageDir) {
        this.repo = repo;
        this.parser = parser;
        this.chunker = chunker;
        this.embeddings = embeddings;
        this.ai = ai;
        this.storageDir = Path.of(storageDir);
    }

    public record Metadata(String title, String category, String version, LocalDate effectiveDate, String region, List<String> tiers) {
    }

    /** Validates and stores the file, records the document, and returns its id. Processing continues asynchronously unless {@code sync}. */
    public UUID submit(Metadata meta, String fileName, byte[] content, UUID uploadedBy, boolean sync) {
        validate(meta, fileName, content);
        DocumentParser.SourceType type = DocumentParser.detect(fileName);
        String checksum = sha256(content);
        repo.findByChecksum(checksum).ifPresent(existing -> {
            throw new BusinessException(HttpStatus.CONFLICT, "DUPLICATE_DOCUMENT",
                    "This file is already uploaded as '" + existing.title() + "' v" + existing.version());
        });
        if (repo.existsTitleVersion(meta.title(), meta.version())) {
            throw new BusinessException(HttpStatus.CONFLICT, "VERSION_EXISTS",
                    "'" + meta.title() + "' version " + meta.version() + " already exists — use a new version number");
        }

        Path stored = store(checksum, fileName, content);
        UUID id = repo.insert(new KnowledgeRepository.NewDocument(meta.title().trim(), meta.category(), meta.region(),
                meta.version().trim(), meta.effectiveDate(), meta.tiers(), type.name(), fileName, stored.toString(), checksum, uploadedBy));

        Runnable work = () -> process(id, meta, type, content);
        if (sync) work.run();
        else Thread.ofVirtual().name("ingest-" + id).start(work);
        return id;
    }

    /** Re-parses a stored document (e.g. after changing chunking or adding an API key). */
    public void reprocess(UUID id) {
        var doc = repo.find(id).orElseThrow(() -> new com.shopsmart.common.NotFoundException("Document not found"));
        byte[] content;
        try {
            content = Files.readAllBytes(Path.of(doc.storagePath()));
        } catch (IOException e) {
            throw new BusinessException(HttpStatus.CONFLICT, "FILE_MISSING", "Stored file is no longer available — upload it again");
        }
        var meta = new Metadata(doc.title(), doc.category(), doc.version(), doc.effectiveDate(), doc.region(), doc.tiers());
        Thread.ofVirtual().name("reingest-" + id).start(() -> process(id, meta, DocumentParser.SourceType.valueOf(doc.sourceType()), content));
    }

    void process(UUID id, Metadata meta, DocumentParser.SourceType type, byte[] content) {
        long t0 = System.currentTimeMillis();
        try {
            repo.setStatus(id, "PROCESSING", null);
            var sections = parser.parse(content, type, meta.title());
            var chunks = chunker.chunk(meta.title(), meta.version(), sections);

            List<String> vectors = new ArrayList<>();
            if (ai.nvidiaConfigured()) {
                var response = embeddings.embedBatched(chunks.stream().map(Chunker.Chunk::content).toList(), NvidiaEmbeddingModel.InputType.passage);
                response.getResults().forEach(r -> vectors.add(ProductEmbeddingService.toVectorLiteral(r.getOutput())));
            } else {
                chunks.forEach(c -> vectors.add(null));
            }

            List<Map<String, Object>> metadata = new ArrayList<>();
            for (var c : chunks) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("documentId", id.toString());
                m.put("document", meta.title());
                m.put("section", c.section());
                m.put("version", meta.version());
                m.put("effectiveDate", meta.effectiveDate().toString());
                m.put("category", meta.category());
                m.put("region", meta.region());
                m.put("tiers", meta.tiers());
                m.put("chunkIndex", c.index());
                m.put("active", false);
                metadata.add(m);
            }
            repo.replaceChunks(id, metadata, chunks.stream().map(Chunker.Chunk::content).toList(), vectors);
            repo.setStatus(id, "READY", ai.nvidiaConfigured() ? null : "Indexed for keyword search; add NVIDIA_API_KEY for semantic search");
            repo.refreshActiveVersion(meta.title());
            log.info("Ingested '{}' v{}: {} sections, {} chunks in {} ms", meta.title(), meta.version(), sections.size(), chunks.size(),
                    System.currentTimeMillis() - t0);
        } catch (RuntimeException e) {
            log.warn("Ingestion failed for {}: {}", id, e.getMessage());
            repo.setStatus(id, "FAILED", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
    }

    /** Embeds chunks indexed before an API key was configured. */
    public int embedMissingChunks() {
        if (!ai.nvidiaConfigured()) return 0;
        int total = 0;
        while (true) {
            var batch = repo.chunksWithoutEmbedding(32);
            if (batch.isEmpty()) return total;
            var res = embeddings.embedBatched(batch.stream().map(KnowledgeRepository.ChunkRow::content).toList(),
                    NvidiaEmbeddingModel.InputType.passage);
            for (int i = 0; i < batch.size(); i++) {
                repo.setEmbedding(batch.get(i).id(), ProductEmbeddingService.toVectorLiteral(res.getResults().get(i).getOutput()));
            }
            total += batch.size();
        }
    }

    private void validate(Metadata m, String fileName, byte[] content) {
        if (content == null || content.length == 0) throw new IllegalArgumentException("The file is empty");
        if (content.length > MAX_BYTES) throw new IllegalArgumentException("Files must be 20 MB or smaller");
        if (fileName == null || fileName.isBlank()) throw new IllegalArgumentException("File name is missing");
        if (m.title() == null || m.title().isBlank() || m.title().length() > 200) throw new IllegalArgumentException("Title is required (max 200 characters)");
        if (m.version() == null || !m.version().trim().matches("[0-9A-Za-z.\\-]{1,20}")) throw new IllegalArgumentException("Version must be like 2026.1");
        if (!CATEGORIES.contains(m.category())) throw new IllegalArgumentException("Unknown category " + m.category());
        if (!REGIONS.contains(m.region())) throw new IllegalArgumentException("Unknown region " + m.region());
        if (m.effectiveDate() == null) throw new IllegalArgumentException("Effective date is required");
        if (m.tiers() == null || m.tiers().isEmpty() || !TIERS.containsAll(m.tiers())) throw new IllegalArgumentException("Tiers must be BASIC, PRIME and/or PREMIUM");
        if (DocumentParser.detect(fileName) == DocumentParser.SourceType.PDF && !(content.length > 4 && new String(content, 0, 4).equals("%PDF"))) {
            throw new IllegalArgumentException("File does not look like a PDF");
        }
    }

    private Path store(String checksum, String fileName, byte[] content) {
        try {
            Files.createDirectories(storageDir);
            String ext = fileName.contains(".") ? fileName.substring(fileName.lastIndexOf('.')) : "";
            Path target = storageDir.resolve(checksum + ext.toLowerCase());
            if (!Files.exists(target)) Files.write(target, content);
            return target;
        } catch (IOException e) {
            throw new IllegalStateException("Could not store the uploaded file", e);
        }
    }

    static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
