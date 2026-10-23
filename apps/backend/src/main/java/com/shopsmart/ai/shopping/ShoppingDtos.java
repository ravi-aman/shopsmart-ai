package com.shopsmart.ai.shopping;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import com.shopsmart.catalog.CatalogDtos.Availability;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class ShoppingDtos {

    private ShoppingDtos() {
    }

    public record RecommendRequest(
            @NotBlank @Size(max = 500) String query,
            @Size(max = 64) String conversationId) {
    }

    /** Matches the brief's contract; fields after {@code clarifyingQuestion} are additive for the UI. */
    public record RecommendResponse(
            String interpretedRequirement,
            BigDecimal budget,
            List<Recommendation> recommendations,
            String clarifyingQuestion,
            String summary,
            Interpretation interpretation,
            List<String> notices,
            UUID auditId,
            boolean aiAssisted) {
    }

    public record Recommendation(
            String productId,
            String productName,
            String reason,
            Availability availability,
            String explanation,
            String slug,
            String brand,
            BigDecimal price,
            BigDecimal mrp,
            String currency,
            String image,
            BigDecimal rating,
            int score,
            List<String> matchedRequirements,
            List<String> tradeoffs,
            List<SpecScorer.Criterion> scoreBreakdown) {
    }

    /** What the assistant understood, shown as chips the shopper can verify. */
    public record Interpretation(
            String category,
            BigDecimal budgetMin,
            BigDecimal budgetMax,
            List<String> useCases,
            Integer minRamGb,
            Integer minStorageGb,
            Boolean needsDedicatedGpu,
            String preferredOs,
            List<String> brands,
            String source) {
    }

    /** One progress step for the streaming endpoint. */
    public record Step(String id, String label, String status, Long durationMs) {
    }
}
