package com.shopsmart.ai.shopping;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.shopsmart.catalog.CatalogDtos.ProductSummary;
import com.shopsmart.catalog.CatalogRepository;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Retrieves in-stock candidates for the assistant: hard constraints in SQL, then hybrid ranking that
 * fuses keyword rank and NVIDIA-embedding similarity with Reciprocal Rank Fusion (k = 60).
 */
@Repository
public class CandidateRepository {

    private static final Set<String> STOP_WORDS = Set.of(
            "suggest", "recommend", "need", "want", "looking", "find", "show", "best", "good", "great", "under", "below",
            "less", "than", "with", "for", "and", "the", "that", "this", "some", "please", "can", "you", "buy", "budget",
            "within", "around", "about", "from", "into", "will", "would", "like", "also", "projects", "project", "usd");

    private final JdbcClient jdbc;
    private final CatalogRepository catalog;

    public CandidateRepository(JdbcClient jdbc, CatalogRepository catalog) {
        this.jdbc = jdbc;
        this.catalog = catalog;
    }

    public record Constraints(String category, BigDecimal minPrice, BigDecimal maxPrice, Integer minRamGb,
                              Integer minStorageGb, boolean dedicatedGpu, String os) {

        Constraints relaxSpecs() {
            return new Constraints(category, minPrice, maxPrice, null, null, false, null);
        }
    }

    public record Candidate(ProductSummary product, double fusedScore) {
    }

    /** How many in-stock products the category holds within budget (for progress messages). */
    public long countInScope(Constraints c) {
        Map<String, Object> params = new HashMap<>();
        String where = where(c, params);
        return jdbc.sql("select count(*) " + CatalogRepository.PRODUCT_FROM + where).params(params).query(Long.class).single();
    }

    public List<Candidate> search(Constraints c, String queryText, float[] queryVector, int limit) {
        Map<String, Object> params = new HashMap<>();
        String where = where(c, params);
        String keywords = keywordQuery(queryText);
        params.put("kw", keywords);
        params.put("limit", limit);

        String vectorCte = "";
        String vectorJoin = "";
        String vectorScore = "0";
        if (queryVector != null) {
            params.put("qv", com.shopsmart.ai.ProductEmbeddingService.toVectorLiteral(queryVector));
            vectorCte = """
                    , vec as (
                        select id, row_number() over (order by embedding <=> cast(:qv as vector)) as r
                        from base where embedding is not null
                    )""";
            vectorJoin = " left join vec on vec.id = base.id";
            vectorScore = "coalesce(1.0 / (60 + vec.r), 0)";
        }

        String sql = """
                with base as (
                    select p.id, p.embedding, p.search_tsv, p.rating, p.rating_count
                """ + CatalogRepository.PRODUCT_FROM + where + """
                ),
                kw as (
                    select id, row_number() over (order by ts_rank_cd(search_tsv, websearch_to_tsquery('english', :kw)) desc) as r
                    from base where :kw <> '' and search_tsv @@ websearch_to_tsquery('english', :kw)
                )""" + vectorCte + """
                select base.id, coalesce(1.0 / (60 + kw.r), 0) + """ + vectorScore + """
                 as fused
                from base left join kw on kw.id = base.id""" + vectorJoin + """
                 order by fused desc, base.rating * ln(base.rating_count + 1) desc, base.id
                 limit :limit
                """;
        List<Map.Entry<String, Double>> ranked = jdbc.sql(sql).params(params)
                .query((rs, n) -> Map.entry(rs.getString(1), rs.getDouble(2)))
                .list();
        if (ranked.isEmpty()) return List.of();

        Map<String, ProductSummary> byId = new HashMap<>();
        catalog.findByIds(ranked.stream().map(Map.Entry::getKey).toList()).forEach(p -> byId.put(p.id(), p));
        return ranked.stream()
                .filter(e -> byId.containsKey(e.getKey()))
                .map(e -> new Candidate(byId.get(e.getKey()), e.getValue()))
                .toList();
    }

    public java.util.Optional<ProductSummary> cheapestInStock(String category) {
        Map<String, Object> params = new HashMap<>();
        String where = where(new Constraints(category, null, null, null, null, false, null), params);
        return jdbc.sql("select p.id " + CatalogRepository.PRODUCT_FROM + where + " order by p.price limit 1")
                .params(params)
                .query(String.class)
                .optional()
                .flatMap(id -> catalog.findByIds(List.of(id)).stream().findFirst());
    }

    private String where(Constraints c, Map<String, Object> params) {
        StringBuilder sql = new StringBuilder(" where p.status = 'ACTIVE' and coalesce(s.available, 0) > 0");
        if (c.category() != null) {
            String path = catalog.categoryPath(c.category()).orElse(c.category());
            sql.append(" and (c.path = :catPath or c.path like :catPrefix)");
            params.put("catPath", path);
            params.put("catPrefix", path + "/%");
        }
        if (c.maxPrice() != null) {
            sql.append(" and p.price <= :maxPrice");
            params.put("maxPrice", c.maxPrice());
        }
        if (c.minPrice() != null) {
            sql.append(" and p.price >= :minPrice");
            params.put("minPrice", c.minPrice());
        }
        if (c.minRamGb() != null) {
            sql.append(" and coalesce((p.specs ->> 'ramGb')::numeric, 0) >= :minRam");
            params.put("minRam", c.minRamGb());
        }
        if (c.minStorageGb() != null) {
            sql.append(" and coalesce((p.specs ->> 'storageGb')::numeric, 0) >= :minStorage");
            params.put("minStorage", c.minStorageGb());
        }
        if (c.dedicatedGpu()) {
            sql.append(" and p.specs ->> 'gpu' ~* '(rtx|gtx|radeon rx)'");
        }
        if (c.os() != null) {
            sql.append(" and p.specs ->> 'os' ilike :os");
            params.put("os", "%" + c.os() + "%");
        }
        return sql.toString();
    }

    /** "Suggest a laptop for Java development and AI" → "java or development or ai" (websearch syntax). */
    static String keywordQuery(String text) {
        if (text == null) return "";
        var words = new java.util.LinkedHashSet<String>();
        for (String w : text.toLowerCase().split("[^a-z0-9]+")) {
            if (w.length() >= 2 && !STOP_WORDS.contains(w) && !w.chars().allMatch(Character::isDigit)) words.add(w);
        }
        return String.join(" or ", words);
    }
}
