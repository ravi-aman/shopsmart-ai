package com.shopsmart.ai.shopping;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;

import com.fasterxml.jackson.annotation.JsonPropertyDescription;

/**
 * Structured reading of a shopping request. Produced by the fast NVIDIA model (or the rule-based
 * parser as fallback) and then sanitised against the catalogue's real categories and vocabularies.
 */
public record ShoppingIntent(
        @JsonPropertyDescription("One short sentence restating what the shopper needs, e.g. 'Laptop for Java development and AI learning'")
        String interpretedRequirement,
        @JsonPropertyDescription("Category slug from the allowed list, or null if the product type is unclear")
        String category,
        @JsonPropertyDescription("Maximum budget in USD, or null if not stated")
        BigDecimal budgetMax,
        @JsonPropertyDescription("Minimum budget in USD, or null if not stated")
        BigDecimal budgetMin,
        @JsonPropertyDescription("Use cases from the allowed vocabulary only")
        List<String> useCases,
        @JsonPropertyDescription("Minimum RAM in GB if the shopper stated or clearly implied one, else null")
        Integer minRamGb,
        @JsonPropertyDescription("Minimum storage in GB if stated, else null")
        Integer minStorageGb,
        @JsonPropertyDescription("true only if the shopper explicitly asks for a dedicated/NVIDIA GPU")
        Boolean needsDedicatedGpu,
        @JsonPropertyDescription("Required operating system if stated (Windows, macOS, ChromeOS), else null")
        String preferredOs,
        @JsonPropertyDescription("Brands the shopper asked for, else empty")
        List<String> brands,
        @JsonPropertyDescription("A single short question to ask ONLY if the product type is unknown; otherwise null")
        String clarifyingQuestion) {

    public static final Set<String> USE_CASES = Set.of(
            "software-development", "ai-ml", "gaming", "office", "student", "travel", "content-creation",
            "photography", "music", "fitness", "cooking", "reading", "health-monitoring", "everyday");

    public ShoppingIntent {
        useCases = useCases == null ? List.of() : useCases;
        brands = brands == null ? List.of() : brands;
    }

    public boolean has(String useCase) {
        return useCases.contains(useCase);
    }

    public ShoppingIntent withCategory(String c) {
        return new ShoppingIntent(interpretedRequirement, c, budgetMax, budgetMin, useCases, minRamGb, minStorageGb,
                needsDedicatedGpu, preferredOs, brands, clarifyingQuestion);
    }

    public ShoppingIntent withBudget(BigDecimal min, BigDecimal max) {
        return new ShoppingIntent(interpretedRequirement, category, max, min, useCases, minRamGb, minStorageGb,
                needsDedicatedGpu, preferredOs, brands, clarifyingQuestion);
    }

    public ShoppingIntent withClarifyingQuestion(String q) {
        return new ShoppingIntent(interpretedRequirement, category, budgetMax, budgetMin, useCases, minRamGb, minStorageGb,
                needsDedicatedGpu, preferredOs, brands, q);
    }
}
