package com.shopsmart.ai;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;

import com.shopsmart.ai.config.AiProperties;
import com.shopsmart.ai.config.NvidiaEmbeddingModel;
import com.shopsmart.common.Json;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Embeds product text (name, brand, category, description, specs) with the NVIDIA embedder so the
 * shopping assistant can match intent like "good for AI projects" semantically, not just by keyword.
 */
@Service
public class ProductEmbeddingService {

    private static final Logger log = LoggerFactory.getLogger(ProductEmbeddingService.class);
    private static final int BATCH = 32;

    private final JdbcClient jdbc;
    private final NvidiaEmbeddingModel embeddings;
    private final AiProperties ai;
    private final Json json;
    private volatile boolean running;

    public ProductEmbeddingService(JdbcClient jdbc, NvidiaEmbeddingModel embeddings, AiProperties ai, Json json) {
        this.jdbc = jdbc;
        this.embeddings = embeddings;
        this.ai = ai;
        this.json = json;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void embedOnStartup() {
        if (!ai.nvidiaConfigured()) {
            log.info("NVIDIA_API_KEY not set: product embeddings skipped, assistant uses keyword retrieval only");
            return;
        }
        Thread.ofVirtual().name("product-embeddings").start(() -> {
            try {
                int n = embedMissing();
                if (n > 0) log.info("Embedded {} products with {}", n, ai.embedding().model());
            } catch (RuntimeException e) {
                log.warn("Product embedding failed; assistant falls back to keyword retrieval: {}", e.getMessage());
            }
        });
    }

    public long missingCount() {
        return jdbc.sql("select count(*) from products where embedding is null and status = 'ACTIVE'").query(Long.class).single();
    }

    /** Embeds every active product without a vector. Returns how many were embedded. */
    public synchronized int embedMissing() {
        if (running) return 0;
        running = true;
        try {
            int total = 0;
            while (true) {
                List<Row> rows = jdbc.sql("""
                                select p.id, p.name, b.name as brand, c.name as category, p.description, p.specs::text as specs, p.tags
                                from products p join brands b on b.id = p.brand_id join categories c on c.id = p.category_id
                                where p.embedding is null and p.status = 'ACTIVE' order by p.id limit :n
                                """)
                        .param("n", BATCH)
                        .query((rs, i) -> new Row(rs.getString("id"), text(rs.getString("name"), rs.getString("brand"),
                                rs.getString("category"), rs.getString("description"), json.toMap(rs.getString("specs")),
                                List.of((String[]) rs.getArray("tags").getArray()))))
                        .list();
                if (rows.isEmpty()) return total;

                var response = embeddings.embedBatched(rows.stream().map(Row::text).toList(), NvidiaEmbeddingModel.InputType.passage);
                for (int i = 0; i < rows.size(); i++) {
                    jdbc.sql("update products set embedding = cast(:v as vector) where id = :id")
                            .param("v", toVectorLiteral(response.getResults().get(i).getOutput()))
                            .param("id", rows.get(i).id())
                            .update();
                }
                total += rows.size();
            }
        } finally {
            running = false;
        }
    }

    static String text(String name, String brand, String category, String description, Map<String, Object> specs, List<String> tags) {
        StringJoiner specText = new StringJoiner("; ");
        specs.forEach((k, v) -> specText.add(k + ": " + v));
        return name + ". Brand: " + brand + ". Category: " + category + ". " + description
                + (specs.isEmpty() ? "" : " Specs: " + specText)
                + (tags.isEmpty() ? "" : ". Tags: " + String.join(", ", tags));
    }

    public static String toVectorLiteral(float[] v) {
        StringBuilder sb = new StringBuilder(v.length * 10).append('[');
        for (int i = 0; i < v.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(v[i]);
        }
        return sb.append(']').toString();
    }

    record Row(String id, String text) {
    }

    /** Exposed for the admin trigger; returns ids still missing after the run. */
    public List<String> idsMissing() {
        return new ArrayList<>(jdbc.sql("select id from products where embedding is null and status = 'ACTIVE' order by id")
                .query(String.class).list());
    }
}
