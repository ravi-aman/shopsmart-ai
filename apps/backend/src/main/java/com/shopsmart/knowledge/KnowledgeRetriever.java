package com.shopsmart.knowledge;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.shopsmart.ai.ProductEmbeddingService;
import com.shopsmart.common.Json;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Hybrid retrieval over approved, active, in-force documents: Postgres full-text rank and pgvector
 * cosine rank fused with Reciprocal Rank Fusion, plus a small boost for the policy category the
 * question is about. Document-level tier and region rules are hard filters.
 */
@Component
public class KnowledgeRetriever {

    static final int RRF_K = 60;
    static final double CATEGORY_BOOST = 0.006;

    private static final Set<String> STOP = Set.of(
            "can", "could", "would", "will", "the", "a", "an", "is", "are", "am", "do", "does", "did", "i", "my", "me", "you", "your",
            "we", "our", "it", "its", "this", "that", "of", "for", "to", "in", "on", "at", "with", "what", "whats", "when", "how",
            "which", "who", "why", "there", "be", "if", "about", "any", "get", "have", "has", "and", "or", "please",
            "tell", "shopsmart", "product", "item");

    /** Question words → policy categories (boost only, never a filter). */
    private static final Map<String, List<String>> CATEGORY_HINTS = new HashMap<>();

    static {
        CATEGORY_HINTS.put("return", List.of("RETURN"));
        CATEGORY_HINTS.put("returnable", List.of("RETURN"));
        CATEGORY_HINTS.put("exchange", List.of("RETURN"));
        CATEGORY_HINTS.put("opened", List.of("RETURN"));
        CATEGORY_HINTS.put("refund", List.of("REFUND"));
        CATEGORY_HINTS.put("money", List.of("REFUND"));
        CATEGORY_HINTS.put("warranty", List.of("WARRANTY"));
        CATEGORY_HINTS.put("guarantee", List.of("WARRANTY"));
        CATEGORY_HINTS.put("repair", List.of("WARRANTY"));
        CATEGORY_HINTS.put("delivery", List.of("SHIPPING", "SLA", "MEMBERSHIP"));
        CATEGORY_HINTS.put("shipping", List.of("SHIPPING"));
        CATEGORY_HINTS.put("deliver", List.of("SHIPPING", "SLA"));
        CATEGORY_HINTS.put("prime", List.of("MEMBERSHIP"));
        CATEGORY_HINTS.put("premium", List.of("MEMBERSHIP"));
        CATEGORY_HINTS.put("membership", List.of("MEMBERSHIP"));
        CATEGORY_HINTS.put("member", List.of("MEMBERSHIP"));
        CATEGORY_HINTS.put("cancel", List.of("CANCELLATION"));
        CATEGORY_HINTS.put("cancellation", List.of("CANCELLATION"));
        CATEGORY_HINTS.put("seller", List.of("SELLER"));
        CATEGORY_HINTS.put("setup", List.of("MANUAL"));
        CATEGORY_HINTS.put("ports", List.of("MANUAL"));
    }

    private final JdbcClient jdbc;
    private final Json json;

    public KnowledgeRetriever(JdbcClient jdbc, Json json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public record Hit(UUID chunkId, UUID documentId, String document, String section, String version, String effectiveDate,
                      String category, String content, Integer keywordRank, Integer vectorRank, Double similarity, double score) {

        /** Chunk text without the context header line. */
        public String body() {
            int nl = content.indexOf('\n');
            return nl > 0 ? content.substring(nl + 1) : content;
        }
    }

    public List<Hit> retrieve(String question, float[] queryVector, String tier, String region, int limit) {
        Map<String, Object> params = new HashMap<>();
        params.put("kw", keywordQuery(question));
        params.put("tier", tier == null ? "BASIC" : tier);
        params.put("region", region == null ? "GLOBAL" : region);
        params.put("cats", categoryHints(question).toArray(String[]::new));
        params.put("boost", CATEGORY_BOOST);
        params.put("limit", limit);

        String vecCte = "";
        String vecJoin = "";
        String vecScore = "0";
        String vecCols = "null::int as vec_rank, null::float8 as similarity";
        if (queryVector != null) {
            params.put("qv", ProductEmbeddingService.toVectorLiteral(queryVector));
            vecCte = """
                    , vec as (
                        select id, row_number() over (order by embedding <=> cast(:qv as vector)) as r,
                               1 - (embedding <=> cast(:qv as vector)) as sim
                        from base where embedding is not null
                        order by embedding <=> cast(:qv as vector) limit 40
                    )""";
            vecJoin = " left join vec on vec.id = base.id";
            vecScore = "coalesce(1.0 / (" + RRF_K + " + vec.r), 0)";
            vecCols = "vec.r::int as vec_rank, vec.sim::float8 as similarity";
        }

        String sql = """
                with base as (
                    select v.id, v.content, v.metadata::text as metadata, v.embedding, v.content_tsv, d.category
                    from vector_store v
                    join documents d on d.id::text = v.metadata ->> 'documentId'
                    where d.is_active and d.status = 'READY' and d.effective_date <= current_date
                      and (d.region = 'GLOBAL' or d.region = :region)
                      and :tier = any(d.applies_to_tiers)
                ),
                kw as (
                    select id, row_number() over (order by ts_rank_cd(content_tsv, websearch_to_tsquery('english', :kw), 32) desc) as r
                    from base where :kw <> '' and content_tsv @@ websearch_to_tsquery('english', :kw)
                    limit 40
                )
                """
                + vecCte
                + " select base.id, base.content, base.metadata, kw.r::int as kw_rank, " + vecCols
                + ", coalesce(1.0 / (" + RRF_K + " + kw.r), 0) + " + vecScore
                + " + case when base.category = any(cast(:cats as text[])) then :boost else 0 end as score"
                + " from base left join kw on kw.id = base.id" + vecJoin
                + " where kw.r is not null" + (queryVector != null ? " or vec.r is not null" : "")
                + " order by score desc limit :limit";

        return jdbc.sql(sql).params(params).query((rs, n) -> {
            Map<String, Object> m = json.toMap(rs.getString("metadata"));
            return new Hit(
                    rs.getObject("id", UUID.class),
                    UUID.fromString(String.valueOf(m.get("documentId"))),
                    String.valueOf(m.get("document")),
                    String.valueOf(m.get("section")),
                    String.valueOf(m.get("version")),
                    String.valueOf(m.get("effectiveDate")),
                    String.valueOf(m.get("category")),
                    rs.getString("content"),
                    (Integer) rs.getObject("kw_rank"),
                    (Integer) rs.getObject("vec_rank"),
                    (Double) rs.getObject("similarity"),
                    rs.getDouble("score"));
        }).list();
    }

    /** Content words in websearch OR syntax, e.g. "return or opened or laptop". */
    static String keywordQuery(String text) {
        return String.join(" or ", contentTerms(text));
    }

    /** Shopper words → the vocabulary policies use. */
    private static final Map<String, String> SYNONYMS = Map.ofEntries(
            Map.entry("shoes", "footwear"), Map.entry("shoe", "footwear"), Map.entry("sneakers", "footwear"),
            Map.entry("clothes", "fashion"), Map.entry("clothing", "fashion"), Map.entry("dress", "fashion"),
            Map.entry("phone", "smartphones"), Map.entry("mobile", "smartphones"), Map.entry("fridge", "refrigerators"),
            Map.entry("ac", "air conditioners"), Map.entry("headphones", "audio"), Map.entry("earbuds", "audio"),
            Map.entry("money", "refund"), Map.entry("ship", "shipping"), Map.entry("deliver", "delivery"));

    public static List<String> contentTerms(String text) {
        Set<String> words = new LinkedHashSet<>();
        for (String w : text.toLowerCase(Locale.ROOT).split("[^a-z0-9]+")) {
            if (w.length() >= 2 && !STOP.contains(w)) {
                words.add(w);
                String syn = SYNONYMS.get(w);
                if (syn != null) words.addAll(List.of(syn.split(" ")));
            }
        }
        return new ArrayList<>(words);
    }

    static Set<String> categoryHints(String text) {
        Set<String> cats = new LinkedHashSet<>();
        for (String w : contentTerms(text)) {
            List<String> hit = CATEGORY_HINTS.get(w);
            if (hit == null && w.endsWith("s")) hit = CATEGORY_HINTS.get(w.substring(0, w.length() - 1));
            if (hit == null && w.endsWith("ed")) hit = CATEGORY_HINTS.get(w.substring(0, w.length() - 2));
            if (hit != null) cats.addAll(hit);
        }
        return cats;
    }
}
