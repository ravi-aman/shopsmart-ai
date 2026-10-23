package com.shopsmart.knowledge;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.shopsmart.ai.RateLimiter;
import com.shopsmart.common.NotFoundException;
import com.shopsmart.knowledge.KnowledgeDtos.AnswerResponse;
import com.shopsmart.knowledge.KnowledgeDtos.AskRequest;
import com.shopsmart.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class KnowledgeController {

    private final KnowledgeAnswerService answers;
    private final KnowledgeRepository repo;
    private final IngestionService ingestion;
    private final RateLimiter rateLimiter;

    public KnowledgeController(KnowledgeAnswerService answers, KnowledgeRepository repo, IngestionService ingestion, RateLimiter rateLimiter) {
        this.answers = answers;
        this.repo = repo;
        this.ingestion = ingestion;
        this.rateLimiter = rateLimiter;
    }

    // ------------------------------------------------------------------ shopper-facing

    /** Module 2 contract: {answer, confidence, sources, followUpRequired}. */
    @PostMapping("/api/ai/knowledge/ask")
    public AnswerResponse ask(@Valid @RequestBody AskRequest req, @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        CurrentUser user = jwt == null ? null : CurrentUser.from(jwt);
        rateLimiter.check(user != null ? "u:" + user.id() : "ip:" + http.getRemoteAddr());
        return answers.answer(req.question().trim(), req.productId(), req.conversationId(), user, step -> {});
    }

    /** Opens a cited section. Only chunks of processed documents are served. */
    @GetMapping("/api/ai/knowledge/chunks/{id}")
    public Map<String, Object> chunk(@PathVariable UUID id) {
        var chunk = repo.chunk(id).orElseThrow(() -> new NotFoundException("Source not found"));
        Map<String, Object> m = chunk.metadata();
        var doc = repo.find(UUID.fromString(String.valueOf(m.get("documentId")))).orElseThrow(() -> new NotFoundException("Source not found"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("chunkId", chunk.id());
        out.put("documentId", doc.id());
        out.put("document", doc.title());
        out.put("section", m.get("section"));
        out.put("version", doc.version());
        out.put("effectiveDate", doc.effectiveDate());
        out.put("category", doc.category());
        out.put("active", doc.active());
        String content = chunk.content();
        int nl = content.indexOf('\n');
        out.put("text", nl > 0 ? content.substring(nl + 1) : content);
        return out;
    }

    // ------------------------------------------------------------------ admin

    @GetMapping("/api/admin/documents")
    @PreAuthorize("hasAnyRole('ADMIN', 'OPS')")
    public List<KnowledgeRepository.DocumentRow> documents() {
        return repo.list();
    }

    @GetMapping("/api/admin/documents/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'OPS')")
    public Map<String, Object> document(@PathVariable UUID id) {
        var doc = repo.find(id).orElseThrow(() -> new NotFoundException("Document not found"));
        return Map.of("document", doc, "chunks", repo.chunks(id));
    }

    @PostMapping(path = "/api/admin/documents", consumes = "multipart/form-data")
    @PreAuthorize("hasAnyRole('ADMIN', 'OPS')")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Object> upload(@RequestParam("file") MultipartFile file,
                                      @RequestParam String title,
                                      @RequestParam String category,
                                      @RequestParam String version,
                                      @RequestParam String effectiveDate,
                                      @RequestParam(defaultValue = "GLOBAL") String region,
                                      @RequestParam(defaultValue = "BASIC,PRIME,PREMIUM") String tiers,
                                      @AuthenticationPrincipal Jwt jwt) throws IOException {
        LocalDate effective;
        try {
            effective = LocalDate.parse(effectiveDate);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("effectiveDate must be YYYY-MM-DD");
        }
        List<String> tierList = Arrays.stream(tiers.split(",")).map(String::trim).map(String::toUpperCase).filter(s -> !s.isEmpty()).toList();
        UUID id = ingestion.submit(new IngestionService.Metadata(title, category.toUpperCase(), version, effective, region.toUpperCase(), tierList),
                file.getOriginalFilename(), file.getBytes(), CurrentUser.from(jwt).id(), false);
        return Map.of("id", id, "status", "PROCESSING");
    }

    @PostMapping("/api/admin/documents/{id}/reprocess")
    @PreAuthorize("hasAnyRole('ADMIN', 'OPS')")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Object> reprocess(@PathVariable UUID id) {
        ingestion.reprocess(id);
        return Map.of("id", id, "status", "PROCESSING");
    }
}
