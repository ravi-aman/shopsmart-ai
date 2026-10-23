package com.shopsmart.catalog;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/** API shapes for the catalog. */
public final class CatalogDtos {

    private CatalogDtos() {
    }

    public enum Availability {
        IN_STOCK, LOW_STOCK, OUT_OF_STOCK;

        static final int LOW_STOCK_THRESHOLD = 10;

        public static Availability of(long available) {
            if (available <= 0) return OUT_OF_STOCK;
            return available <= LOW_STOCK_THRESHOLD ? LOW_STOCK : IN_STOCK;
        }
    }

    public record ProductSummary(
            String id,
            String slug,
            String name,
            String brand,
            String categorySlug,
            String categoryName,
            BigDecimal price,
            BigDecimal mrp,
            String currency,
            BigDecimal rating,
            int ratingCount,
            String image,
            Map<String, Object> specs,
            Availability availability,
            long availableQuantity) {
    }

    public record CategoryNode(int id, String slug, String name, String path, long productCount, List<CategoryNode> children) {
    }

    public record Breadcrumb(String slug, String name) {
    }

    public record WarehouseStock(String warehouseId, String city, String region, long available) {
    }

    public record ProductDetail(
            ProductSummary product,
            String description,
            List<String> images,
            List<String> tags,
            List<Breadcrumb> breadcrumbs,
            List<WarehouseStock> stockByWarehouse,
            List<ProductSummary> related) {
    }

    public record FacetValue(String value, String label, long count) {
    }

    public record Facet(String key, String label, List<FacetValue> values) {
    }

    public record PriceRange(BigDecimal min, BigDecimal max) {
    }

    public record SearchFacets(List<Facet> facets, PriceRange price) {
    }

    public record SearchResponse(
            List<ProductSummary> items,
            int page,
            int size,
            long totalItems,
            int totalPages,
            SearchFacets facets) {
    }

    public record Suggestion(String type, String label, String slug) {
    }
}
