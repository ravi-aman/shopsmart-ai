package com.shopsmart.ops;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.shopsmart.ai.AuditService;
import com.shopsmart.ai.RateLimiter;
import com.shopsmart.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ops")
@PreAuthorize("hasAnyRole('ADMIN', 'OPS')")
public class OpsController {

    private final OpsService ops;
    private final ForecastService forecast;
    private final OpsAgentService agent;
    private final AuditService audit;
    private final RateLimiter rateLimiter;

    public OpsController(OpsService ops, ForecastService forecast, OpsAgentService agent, AuditService audit, RateLimiter rateLimiter) {
        this.ops = ops;
        this.forecast = forecast;
        this.agent = agent;
        this.audit = audit;
        this.rateLimiter = rateLimiter;
    }

    @GetMapping("/kpis")
    public Map<String, Object> kpis() {
        return ops.kpis();
    }

    @GetMapping("/forecast")
    public List<ForecastService.RiskRow> risks() {
        return forecast.risks();
    }

    @GetMapping("/inventory")
    public List<ForecastService.StockPosition> inventory(@RequestParam(required = false) String productId) {
        return forecast.positions().stream()
                .filter(p -> productId == null || p.productId().equalsIgnoreCase(productId))
                .sorted(java.util.Comparator.comparing(ForecastService.StockPosition::productId).thenComparing(ForecastService.StockPosition::warehouseId))
                .toList();
    }

    @GetMapping("/issues")
    public List<Map<String, Object>> issues() {
        return ops.issues();
    }

    @GetMapping("/overstock")
    public List<Map<String, Object>> overstock() {
        return forecast.overstock(10);
    }

    public record AskRequest(@NotBlank @Size(max = 500) String question) {
    }

    @PostMapping("/agent")
    public OpsAgentService.OpsAnswer ask(@Valid @RequestBody AskRequest req, @AuthenticationPrincipal Jwt jwt) {
        CurrentUser user = CurrentUser.from(jwt);
        rateLimiter.check("ops:" + user.id());
        return agent.ask(req.question().trim(), user);
    }

    public record TransferRequest(
            @NotBlank @Size(max = 20) String productId,
            @NotBlank @Pattern(regexp = "WH-[A-Z]{3}") String fromWarehouse,
            @NotBlank @Pattern(regexp = "WH-[A-Z]{3}") String toWarehouse,
            @NotNull @Min(1) @Max(1000) Integer quantity,
            UUID auditId) {
    }

    /** Human approval of a transfer (possibly proposed by the ops agent; the audit entry is marked approved). */
    @PostMapping("/transfers")
    public Map<String, Object> transfer(@Valid @RequestBody TransferRequest req, @AuthenticationPrincipal Jwt jwt) {
        var result = ops.transfer(req.productId().toUpperCase(), req.fromWarehouse(), req.toWarehouse(), req.quantity(), CurrentUser.from(jwt).id());
        if (req.auditId() != null) audit.markApproved(req.auditId());
        return result;
    }

    @GetMapping("/promotions")
    public List<Map<String, Object>> promotions() {
        return ops.promotions();
    }

    public record PromotionRequest(
            @NotBlank @Size(max = 20) String productId,
            @NotNull @DecimalMin("1") @DecimalMax("50") BigDecimal discountPercent,
            @Min(1) @Max(60) int days,
            @Size(max = 500) String rationale,
            boolean fromAgent,
            UUID auditId) {
    }

    @PostMapping("/promotions")
    public Map<String, Object> createPromotion(@Valid @RequestBody PromotionRequest req) {
        UUID id = ops.createDraft(req.productId(), req.discountPercent(), req.days() == 0 ? 14 : req.days(), req.rationale(),
                req.fromAgent() ? "AGENT" : "HUMAN");
        if (req.auditId() != null) audit.markApproved(req.auditId());
        return Map.of("id", id, "status", "DRAFT");
    }

    @PostMapping("/promotions/{id}/activate")
    public Map<String, Object> activate(@PathVariable UUID id) {
        ops.setPromotionStatus(id, "ACTIVE");
        return Map.of("id", id, "status", "ACTIVE");
    }

    @PostMapping("/promotions/{id}/end")
    public Map<String, Object> end(@PathVariable UUID id) {
        ops.setPromotionStatus(id, "ENDED");
        return Map.of("id", id, "status", "ENDED");
    }

    @GetMapping("/audit")
    public List<Map<String, Object>> auditLog(@RequestParam(required = false) String agent,
                                              @RequestParam(required = false) String confidence,
                                              @RequestParam(defaultValue = "false") boolean fallbacksOnly,
                                              @RequestParam(defaultValue = "100") int limit) {
        return ops.auditLog(agent, confidence, fallbacksOnly, Math.max(1, Math.min(limit, 500)));
    }
}
