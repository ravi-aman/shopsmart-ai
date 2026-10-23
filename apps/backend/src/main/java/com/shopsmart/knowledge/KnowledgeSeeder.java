package com.shopsmart.knowledge;

import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.List;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Ingests the approved policy documents in seed/knowledge through the same pipeline as admin uploads,
 * once, into an empty knowledge base. Also embeds chunks indexed before an NVIDIA key was configured.
 */
@Component
@Order(2)
public class KnowledgeSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(KnowledgeSeeder.class);

    private final IngestionService ingestion;
    private final KnowledgeRepository repo;
    private final ObjectMapper mapper;

    public KnowledgeSeeder(IngestionService ingestion, KnowledgeRepository repo, ObjectMapper mapper) {
        this.ingestion = ingestion;
        this.repo = repo;
        this.mapper = mapper;
    }

    record Entry(String file, String title, String category, String version, LocalDate effectiveDate, String region, List<String> tiers) {
    }

    @Override
    public void run(ApplicationArguments args) throws IOException {
        if (repo.count() > 0) return;
        List<Entry> manifest;
        try (InputStream in = new ClassPathResource("seed/knowledge/manifest.json").getInputStream()) {
            manifest = mapper.readValue(in, new TypeReference<>() {});
        }
        for (Entry e : manifest) {
            byte[] content;
            try (InputStream in = new ClassPathResource("seed/knowledge/" + e.file()).getInputStream()) {
                content = in.readAllBytes();
            }
            ingestion.submit(new IngestionService.Metadata(e.title(), e.category(), e.version(), e.effectiveDate(), e.region(), e.tiers()),
                    e.file(), content, null, true);
        }
        log.info("Seeded {} knowledge documents", manifest.size());
    }

    @EventListener(ApplicationReadyEvent.class)
    public void embedPending() {
        Thread.ofVirtual().name("chunk-embeddings").start(() -> {
            try {
                int n = ingestion.embedMissingChunks();
                if (n > 0) log.info("Embedded {} knowledge chunks", n);
            } catch (RuntimeException e) {
                log.warn("Chunk embedding failed; knowledge search stays keyword-only: {}", e.getMessage());
            }
        });
    }
}
