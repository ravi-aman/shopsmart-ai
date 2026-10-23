package com.shopsmart.ai;

import java.util.Map;
import java.util.UUID;

import com.shopsmart.common.NotFoundException;
import com.shopsmart.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** "Why this?" — the full trace behind one AI answer, plus thumbs up/down feedback. */
@RestController
@RequestMapping("/api/ai")
public class AiAuditController {

    private final AuditService audit;
    private final ProductEmbeddingService productEmbeddings;

    public AiAuditController(AuditService audit, ProductEmbeddingService productEmbeddings) {
        this.audit = audit;
        this.productEmbeddings = productEmbeddings;
    }

    /** Owners see their own traces; anonymous traces are visible by id; admins/ops see all. */
    @GetMapping("/decisions/{id}")
    public Map<String, Object> decision(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        Map<String, Object> entry = audit.find(id).orElseThrow(() -> new NotFoundException("Decision not found"));
        Object owner = entry.get("userId");
        if (owner != null) {
            CurrentUser me = jwt == null ? null : CurrentUser.from(jwt);
            boolean staff = me != null && !"CUSTOMER".equals(me.role());
            if (me == null || !(staff || owner.equals(me.id()))) throw new NotFoundException("Decision not found");
        }
        entry.remove("userId");
        return entry;
    }

    @PostMapping("/decisions/{id}/feedback")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void feedback(@PathVariable UUID id, @Valid @RequestBody FeedbackRequest req, @AuthenticationPrincipal Jwt jwt) {
        if (req.rating() == 0) throw new IllegalArgumentException("rating must be 1 or -1");
        if (audit.find(id).isEmpty()) throw new NotFoundException("Decision not found");
        audit.feedback(id, CurrentUser.from(jwt).id(), req.rating(), req.comment());
    }

    @PostMapping("/admin/embed-products")
    @PreAuthorize("hasAnyRole('ADMIN', 'OPS')")
    public Map<String, Object> embedProducts() {
        int embedded = productEmbeddings.embedMissing();
        return Map.of("embedded", embedded, "stillMissing", productEmbeddings.missingCount());
    }

    public record FeedbackRequest(@NotNull @Min(-1) @Max(1) Integer rating, @Size(max = 500) String comment) {
    }
}
