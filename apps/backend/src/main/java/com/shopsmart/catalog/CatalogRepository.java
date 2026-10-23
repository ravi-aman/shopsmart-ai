package com.shopsmart.catalog;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.shopsmart.catalog.CatalogDtos.Availability;
import com.shopsmart.catalog.CatalogDtos.Breadcrumb;
import com.shopsmart.catalog.CatalogDtos.Facet;
import com.shopsmart.catalog.CatalogDtos.FacetValue;
import com.shopsmart.catalog.CatalogDtos.PriceRange;
import com.shopsmart.catalog.CatalogDtos.ProductSummary;
import com.shopsmart.catalog.CatalogDtos.Suggestion;
import com.shopsmart.catalog.CatalogDtos.WarehouseStock;
import com.shopsmart.common.Json;
import com.shopsmart.common.NotFoundException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Hand-written SQL for listing, search and facets. Search combines Postgres full-text rank
 * with trigram word similarity so typos ("lenvo thinkpad") still match.
 */
@Repository
public class CatalogRepository {

    /** Spec keys exposed as filters, in display order. */
    public static final Map<String, String> SPEC_FACETS = new LinkedHashMap<>();

    static {
        SPEC_FACETS.put("ramGb", "RAM (GB)");
        SPEC_FACETS.put("storageGb", "Storage (GB)");
        SPEC_FACETS.put("displayInches", "Screen size (in)");
        SPEC_FACETS.put("os", "Operating system");
        SPEC_FACETS.put("formFactor", "Type");
        SPEC_FACETS.put("format", "Format");
        SPEC_FACETS.put("energyRating", "Energy rating");
    }

    static final String PRODUCT_COLUMNS = """
            p.id, p.slug, p.name, b.name as brand, c.slug as category_slug, c.name as category_name,
            p.price, p.mrp, p.currency, p.rating, p.rating_count, p.images ->> 0 as image, p.specs::text as specs,
            coalesce(s.available, 0) as available
            """;

    static final String PRODUCT_FROM = """
            from products p
            join categories c on c.id = p.category_id
            join brands b on b.id = p.brand_id
            left join lateral (
                select sum(greatest(i.on_hand - i.reserved, 0)) as available
                from inventory i where i.product_id = p.id
            ) s on true
            """;

    private final JdbcClient jdbc;
    private final Json json;

    public CatalogRepository(JdbcClient jdbc, Json json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    // ------------------------------------------------------------------ search

    public long count(ProductQuery query) {
        Where where = where(query, true);
        return jdbc.sql("select count(*) " + PRODUCT_FROM + where.sql)
                .params(where.params)
                .query(Long.class)
                .single();
    }

    public List<ProductSummary> search(ProductQuery query) {
        Where where = where(query, true);
        String sql = "select " + PRODUCT_COLUMNS + PRODUCT_FROM + where.sql
                + " order by " + orderBy(query) + " limit :limit offset :offset";
        where.params.put("limit", query.size());
        where.params.put("offset", query.page() * query.size());
        return jdbc.sql(sql).params(where.params).query(this::mapSummary).list();
    }

    /** Facets use only the text query and category, so selecting a brand doesn't hide the other brands. */
    public List<Facet> facets(ProductQuery query) {
        Where base = where(query, false);
        List<Facet> facets = new ArrayList<>();

        List<FacetValue> categories = jdbc.sql("select c.slug, c.name, count(*) " + PRODUCT_FROM + base.sql
                        + " group by c.slug, c.name order by count(*) desc")
                .params(base.params)
                .query((rs, n) -> new FacetValue(rs.getString(1), rs.getString(2), rs.getLong(3)))
                .list();
        if (categories.size() > 1) facets.add(new Facet("category", "Category", categories));

        List<FacetValue> brands = jdbc.sql("select b.name, count(*) " + PRODUCT_FROM + base.sql
                        + " group by b.name order by count(*) desc, b.name limit 40")
                .params(base.params)
                .query((rs, n) -> new FacetValue(rs.getString(1), rs.getString(1), rs.getLong(2)))
                .list();
        if (!brands.isEmpty()) facets.add(new Facet("brand", "Brand", brands));

        Map<String, List<FacetValue>> specValues = new LinkedHashMap<>();
        jdbc.sql("select k.key, p.specs ->> k.key as v, count(*) " + PRODUCT_FROM
                        + " cross join unnest(cast(:specKeys as text[])) as k(key) " + base.sql
                        + " and p.specs ->> k.key is not null group by k.key, v")
                .params(base.params)
                .param("specKeys", SPEC_FACETS.keySet().toArray(String[]::new))
                .query((rs, n) -> Map.entry(rs.getString(1), new FacetValue(rs.getString(2), rs.getString(2), rs.getLong(3))))
                .list()
                .forEach(e -> specValues.computeIfAbsent(e.getKey(), k -> new ArrayList<>()).add(e.getValue()));
        for (var entry : SPEC_FACETS.entrySet()) {
            List<FacetValue> values = specValues.getOrDefault(entry.getKey(), List.of());
            if (values.size() < 2) continue;
            List<FacetValue> sorted = new ArrayList<>(values);
            sorted.sort((a, b) -> compareFacetValues(a.value(), b.value()));
            facets.add(new Facet("spec." + entry.getKey(), entry.getValue(), sorted));
        }

        long inStock = jdbc.sql("select count(*) " + PRODUCT_FROM + base.sql + " and coalesce(s.available, 0) > 0")
                .params(base.params).query(Long.class).single();
        facets.add(new Facet("availability", "Availability", List.of(new FacetValue("IN_STOCK", "In stock only", inStock))));
        return facets;
    }

    public PriceRange priceRange(ProductQuery query) {
        Where base = where(query, false);
        return jdbc.sql("select min(p.price), max(p.price) " + PRODUCT_FROM + base.sql)
                .params(base.params)
                .query((rs, n) -> new PriceRange(rs.getBigDecimal(1), rs.getBigDecimal(2)))
                .single();
    }

    public List<Suggestion> suggest(String q) {
        List<Suggestion> out = new ArrayList<>(jdbc.sql("""
                        select c.name, c.slug from categories c
                        where c.name ilike :prefix or c.name ilike :contains
                        order by (c.name ilike :prefix) desc, length(c.name) limit 3
                        """)
                .param("prefix", escapeLike(q) + "%")
                .param("contains", "% " + escapeLike(q) + "%")
                .query((rs, n) -> new Suggestion("category", rs.getString(1), rs.getString(2)))
                .list());
        out.addAll(jdbc.sql("""
                        select p.name, p.slug from products p join brands b on b.id = p.brand_id
                        where p.status = 'ACTIVE'
                          and ((' ' || lower(p.name)) like :wordPrefix or b.name ilike :prefix or word_similarity(:q, p.name) > 0.6)
                        order by (b.name ilike :prefix or p.name ilike :prefix) desc, word_similarity(:q, p.name) desc,
                                 p.rating_count desc
                        limit 7
                        """)
                .param("q", q)
                .param("prefix", escapeLike(q) + "%")
                .param("wordPrefix", "% " + escapeLike(q.toLowerCase()) + "%")
                .query((rs, n) -> new Suggestion("product", rs.getString(1), rs.getString(2)))
                .list());
        return out;
    }

    // ------------------------------------------------------------------ single products

    public Optional<ProductRow> findByIdOrSlug(String idOrSlug) {
        return jdbc.sql("select " + PRODUCT_COLUMNS + ", p.description, p.images::text as images_json, p.tags, c.path, p.category_id "
                        + PRODUCT_FROM + " where p.status = 'ACTIVE' and (p.id = upper(:key) or p.slug = :key)")
                .param("key", idOrSlug)
                .query((rs, n) -> new ProductRow(
                        mapSummary(rs, n),
                        rs.getString("description"),
                        json.toStringList(rs.getString("images_json")),
                        List.of((String[]) rs.getArray("tags").getArray()),
                        rs.getString("path"),
                        rs.getInt("category_id")))
                .optional();
    }

    public List<ProductSummary> findByIds(List<String> ids) {
        return jdbc.sql("select " + PRODUCT_COLUMNS + PRODUCT_FROM
                        + " where p.status = 'ACTIVE' and p.id = any(:ids)")
                .param("ids", ids.stream().map(String::toUpperCase).toArray(String[]::new))
                .query(this::mapSummary)
                .list();
    }

    public List<ProductSummary> related(String productId, int categoryId, java.math.BigDecimal price, int limit) {
        return jdbc.sql("select " + PRODUCT_COLUMNS + PRODUCT_FROM + """
                         where p.status = 'ACTIVE' and p.category_id = :cat and p.id <> :id
                         order by abs(p.price - :price), p.rating desc limit :limit
                        """)
                .param("cat", categoryId)
                .param("id", productId)
                .param("price", price)
                .param("limit", limit)
                .query(this::mapSummary)
                .list();
    }

    public List<WarehouseStock> stockByWarehouse(String productId) {
        return jdbc.sql("""
                        select w.id, w.city, w.region, greatest(i.on_hand - i.reserved, 0)
                        from inventory i join warehouses w on w.id = i.warehouse_id
                        where i.product_id = :id order by w.city
                        """)
                .param("id", productId)
                .query((rs, n) -> new WarehouseStock(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4)))
                .list();
    }

    public List<Breadcrumb> breadcrumbs(String path) {
        String[] slugs = path.split("/");
        Map<String, String> names = new HashMap<>();
        jdbc.sql("select slug, name from categories where slug = any(:slugs)")
                .param("slugs", slugs)
                .query((rs, n) -> Map.entry(rs.getString(1), rs.getString(2)))
                .list()
                .forEach(e -> names.put(e.getKey(), e.getValue()));
        List<Breadcrumb> crumbs = new ArrayList<>();
        for (String slug : slugs) crumbs.add(new Breadcrumb(slug, names.getOrDefault(slug, slug)));
        return crumbs;
    }

    public List<CategoryRow> categories() {
        return jdbc.sql("""
                        select c.id, c.parent_id, c.slug, c.name, c.path,
                               (select count(*) from products p where p.category_id = c.id and p.status = 'ACTIVE') as direct_count
                        from categories c order by c.sort_order
                        """)
                .query((rs, n) -> new CategoryRow(rs.getInt(1), (Integer) rs.getObject(2), rs.getString(3),
                        rs.getString(4), rs.getString(5), rs.getLong(6)))
                .list();
    }

    public Optional<String> categoryPath(String slug) {
        return jdbc.sql("select path from categories where slug = :slug").param("slug", slug).query(String.class).optional();
    }

    // ------------------------------------------------------------------ internals

    record Where(String sql, Map<String, Object> params) {
    }

    private Where where(ProductQuery q, boolean includeRefinements) {
        StringBuilder sql = new StringBuilder(" where p.status = 'ACTIVE'");
        Map<String, Object> params = new HashMap<>();

        if (q.category() != null) {
            String path = categoryPath(q.category())
                    .orElseThrow(() -> new NotFoundException("Category '" + q.category() + "' not found"));
            sql.append(" and (c.path = :catPath or c.path like :catPrefix)");
            params.put("catPath", path);
            params.put("catPrefix", path + "/%");
        }
        if (q.hasText()) {
            sql.append("""
                     and (p.search_tsv @@ websearch_to_tsquery('english', :q)
                          or word_similarity(:q, p.name) > 0.45
                          or b.name ilike :qLike
                          or c.name ilike :qLike
                          or lower(:q) = any(p.tags))
                    """);
            params.put("q", q.q().trim());
            params.put("qLike", "%" + escapeLike(q.q().trim()) + "%");
        }
        if (includeRefinements) {
            if (q.brands() != null && !q.brands().isEmpty()) {
                sql.append(" and b.name = any(:brands)");
                params.put("brands", q.brands().toArray(String[]::new));
            }
            if (q.minPrice() != null) {
                sql.append(" and p.price >= :minPrice");
                params.put("minPrice", q.minPrice());
            }
            if (q.maxPrice() != null) {
                sql.append(" and p.price <= :maxPrice");
                params.put("maxPrice", q.maxPrice());
            }
            if (q.minRating() != null) {
                sql.append(" and p.rating >= :minRating");
                params.put("minRating", q.minRating());
            }
            if (q.inStockOnly()) {
                sql.append(" and coalesce(s.available, 0) > 0");
            }
            int i = 0;
            for (var filter : q.specFilters().entrySet()) {
                if (!SPEC_FACETS.containsKey(filter.getKey()) || filter.getValue().isEmpty()) continue;
                // Key comes from the whitelist above, never from raw input, so inlining it is safe.
                sql.append(" and p.specs ->> '").append(filter.getKey()).append("' = any(:spec").append(i).append(")");
                params.put("spec" + i, filter.getValue().toArray(String[]::new));
                i++;
            }
        }
        return new Where(sql.toString(), params);
    }

    private static String orderBy(ProductQuery q) {
        return switch (q.sort()) {
            case PRICE_ASC -> "p.price asc, p.id";
            case PRICE_DESC -> "p.price desc, p.id";
            case RATING -> "p.rating desc, p.rating_count desc, p.id";
            case NEWEST -> "p.created_at desc, p.id";
            case RELEVANCE -> q.hasText()
                    ? "(ts_rank_cd(p.search_tsv, websearch_to_tsquery('english', :q)) * 2 + word_similarity(:q, p.name)) desc, "
                      + "(coalesce(s.available, 0) > 0) desc, p.rating_count desc, p.id"
                    : "(coalesce(s.available, 0) > 0) desc, p.rating * ln(p.rating_count + 1) desc, p.id";
        };
    }

    private ProductSummary mapSummary(ResultSet rs, int rowNum) throws SQLException {
        long available = rs.getLong("available");
        return new ProductSummary(
                rs.getString("id"),
                rs.getString("slug"),
                rs.getString("name"),
                rs.getString("brand"),
                rs.getString("category_slug"),
                rs.getString("category_name"),
                rs.getBigDecimal("price"),
                rs.getBigDecimal("mrp"),
                rs.getString("currency"),
                rs.getBigDecimal("rating"),
                rs.getInt("rating_count"),
                rs.getString("image"),
                json.toMap(rs.getString("specs")),
                Availability.of(available),
                available);
    }

    /** Escapes LIKE wildcards in user input (Postgres default escape character is backslash). */
    static String escapeLike(String s) {
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static int compareFacetValues(String a, String b) {
        try {
            return Double.compare(Double.parseDouble(a), Double.parseDouble(b));
        } catch (NumberFormatException e) {
            return a.compareToIgnoreCase(b);
        }
    }

    public record ProductRow(ProductSummary summary, String description, List<String> images, List<String> tags,
                             String categoryPath, int categoryId) {
    }

    public record CategoryRow(int id, Integer parentId, String slug, String name, String path, long directCount) {
    }
}
