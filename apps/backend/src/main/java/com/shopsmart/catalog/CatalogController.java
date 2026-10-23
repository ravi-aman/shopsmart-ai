package com.shopsmart.catalog;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.shopsmart.catalog.CatalogDtos.CategoryNode;
import com.shopsmart.catalog.CatalogDtos.ProductDetail;
import com.shopsmart.catalog.CatalogDtos.ProductSummary;
import com.shopsmart.catalog.CatalogDtos.SearchFacets;
import com.shopsmart.catalog.CatalogDtos.SearchResponse;
import com.shopsmart.catalog.CatalogDtos.Suggestion;
import com.shopsmart.common.NotFoundException;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/catalog")
public class CatalogController {

    static final int MAX_PAGE_SIZE = 60;
    static final int MAX_COMPARE = 4;

    private final CatalogRepository catalog;

    public CatalogController(CatalogRepository catalog) {
        this.catalog = catalog;
    }

    @GetMapping("/categories")
    public List<CategoryNode> categories() {
        List<CatalogRepository.CategoryRow> rows = catalog.categories();
        Map<Integer, List<CatalogRepository.CategoryRow>> byParent = new HashMap<>();
        for (var row : rows) byParent.computeIfAbsent(row.parentId(), k -> new ArrayList<>()).add(row);
        return build(byParent, null);
    }

    private List<CategoryNode> build(Map<Integer, List<CatalogRepository.CategoryRow>> byParent, Integer parentId) {
        List<CategoryNode> nodes = new ArrayList<>();
        for (var row : byParent.getOrDefault(parentId, List.of())) {
            List<CategoryNode> children = build(byParent, row.id());
            long count = row.directCount() + children.stream().mapToLong(CategoryNode::productCount).sum();
            nodes.add(new CategoryNode(row.id(), row.slug(), row.name(), row.path(), count, children));
        }
        return nodes;
    }

    /**
     * Listing + search. Filters: q, category, brand (repeatable or comma separated), minPrice, maxPrice,
     * minRating, inStock, spec.&lt;key&gt; (e.g. spec.ramGb=16), sort, page, size.
     */
    @GetMapping("/products")
    public SearchResponse products(@RequestParam MultiValueMap<String, String> params) {
        ProductQuery query = parseQuery(params);
        List<ProductSummary> items = catalog.search(query);
        long total = catalog.count(query);
        SearchFacets facets = new SearchFacets(catalog.facets(query), catalog.priceRange(query));
        int totalPages = (int) Math.ceil((double) total / query.size());
        return new SearchResponse(items, query.page(), query.size(), total, totalPages, facets);
    }

    @GetMapping("/products/{idOrSlug}")
    public ProductDetail product(@PathVariable String idOrSlug) {
        var row = catalog.findByIdOrSlug(idOrSlug)
                .orElseThrow(() -> new NotFoundException("Product '" + idOrSlug + "' not found"));
        ProductSummary p = row.summary();
        return new ProductDetail(
                p,
                row.description(),
                row.images(),
                row.tags(),
                catalog.breadcrumbs(row.categoryPath()),
                catalog.stockByWarehouse(p.id()),
                catalog.related(p.id(), row.categoryId(), p.price(), 8),
                catalog.activePromotion(p.id()).orElse(null));
    }

    /** Summaries for a set of ids (guest cart, recently viewed). Unknown ids are skipped. */
    @GetMapping("/products/batch")
    public List<ProductSummary> batch(@RequestParam List<String> ids) {
        List<String> unique = ids.stream().flatMap(s -> Arrays.stream(s.split(","))).map(String::trim)
                .filter(s -> !s.isEmpty()).distinct().toList();
        if (unique.isEmpty()) return List.of();
        if (unique.size() > 50) throw new IllegalArgumentException("At most 50 ids");
        return catalog.findByIds(unique);
    }

    @GetMapping("/compare")
    public List<ProductSummary> compare(@RequestParam List<String> ids) {
        List<String> unique = ids.stream().flatMap(s -> Arrays.stream(s.split(","))).map(String::trim)
                .filter(s -> !s.isEmpty()).distinct().toList();
        if (unique.size() < 2 || unique.size() > MAX_COMPARE) {
            throw new IllegalArgumentException("Compare needs between 2 and " + MAX_COMPARE + " products");
        }
        Map<String, ProductSummary> found = new LinkedHashMap<>();
        catalog.findByIds(unique).forEach(p -> found.put(p.id(), p));
        return unique.stream().map(String::toUpperCase).map(id -> {
            ProductSummary p = found.get(id);
            if (p == null) throw new NotFoundException("Product '" + id + "' not found");
            return p;
        }).toList();
    }

    @GetMapping("/suggest")
    public List<Suggestion> suggest(@RequestParam String q) {
        String trimmed = q.trim();
        return trimmed.length() < 2 ? List.of() : catalog.suggest(trimmed.length() > 80 ? trimmed.substring(0, 80) : trimmed);
    }

    static ProductQuery parseQuery(MultiValueMap<String, String> params) {
        Map<String, List<String>> specs = new LinkedHashMap<>();
        params.forEach((key, values) -> {
            if (key.startsWith("spec.")) specs.put(key.substring(5), splitAll(values));
        });
        int page = intParam(params, "page", 0);
        int size = intParam(params, "size", 24);
        if (page < 0) throw new IllegalArgumentException("page must be >= 0");
        if (size < 1 || size > MAX_PAGE_SIZE) throw new IllegalArgumentException("size must be 1-" + MAX_PAGE_SIZE);
        String q = params.getFirst("q");
        if (q != null && q.length() > 200) throw new IllegalArgumentException("q is too long");
        return new ProductQuery(
                q == null || q.isBlank() ? null : q,
                blankToNull(params.getFirst("category")),
                splitAll(params.getOrDefault("brand", List.of())),
                decimalParam(params, "minPrice"),
                decimalParam(params, "maxPrice"),
                decimalParam(params, "minRating"),
                "true".equalsIgnoreCase(params.getFirst("inStock")),
                specs,
                ProductQuery.Sort.parse(params.getFirst("sort")),
                page,
                size);
    }

    private static List<String> splitAll(List<String> values) {
        return values.stream().flatMap(v -> Arrays.stream(v.split(","))).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static int intParam(MultiValueMap<String, String> params, String name, int fallback) {
        String v = params.getFirst(name);
        if (v == null || v.isBlank()) return fallback;
        try {
            return Integer.parseInt(v.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " must be a number");
        }
    }

    private static BigDecimal decimalParam(MultiValueMap<String, String> params, String name) {
        String v = params.getFirst(name);
        if (v == null || v.isBlank()) return null;
        try {
            return new BigDecimal(v.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " must be a number");
        }
    }
}
