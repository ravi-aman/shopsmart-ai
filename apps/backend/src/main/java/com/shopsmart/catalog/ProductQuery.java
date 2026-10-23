package com.shopsmart.catalog;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Parsed listing/search request. {@code specFilters} holds values for whitelisted spec keys,
 * e.g. {@code ramGb -> [16, 32]}.
 */
public record ProductQuery(
        String q,
        String category,
        List<String> brands,
        BigDecimal minPrice,
        BigDecimal maxPrice,
        BigDecimal minRating,
        boolean inStockOnly,
        Map<String, List<String>> specFilters,
        Sort sort,
        int page,
        int size) {

    public enum Sort {
        RELEVANCE, PRICE_ASC, PRICE_DESC, RATING, NEWEST;

        public static Sort parse(String value) {
            if (value == null || value.isBlank()) return RELEVANCE;
            try {
                return valueOf(value.trim().toUpperCase());
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("Unknown sort '" + value + "'");
            }
        }
    }

    public boolean hasText() {
        return q != null && !q.isBlank();
    }
}
