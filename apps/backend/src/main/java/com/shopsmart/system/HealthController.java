package com.shopsmart.system;

import java.util.LinkedHashMap;
import java.util.Map;

import com.shopsmart.ai.config.AiProperties;
import com.shopsmart.ai.config.NvidiaEmbeddingModel;
import com.shopsmart.common.NotFoundException;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/health")
public class HealthController {

    private final JdbcClient jdbc;
    private final ChatClient fastChatClient;
    private final NvidiaEmbeddingModel embeddingModel;
    private final AiProperties aiProperties;
    private final boolean devEndpointsEnabled;

    public HealthController(JdbcClient jdbc,
                            @Qualifier("fast") ChatClient fastChatClient,
                            NvidiaEmbeddingModel embeddingModel,
                            AiProperties aiProperties,
                            @Value("${DEV_ENDPOINTS_ENABLED:false}") boolean devEndpointsEnabled) {
        this.jdbc = jdbc;
        this.fastChatClient = fastChatClient;
        this.embeddingModel = embeddingModel;
        this.aiProperties = aiProperties;
        this.devEndpointsEnabled = devEndpointsEnabled;
    }

    /** Database reachability, pgvector presence and seeded row counts. */
    @GetMapping
    public Map<String, Object> health() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", "UP");
        out.put("database", jdbc.sql("select version()").query(String.class).single());
        out.put("pgvector", jdbc.sql("select extversion from pg_extension where extname = 'vector'")
                .query(String.class).optional().orElse("NOT INSTALLED"));
        out.put("products", jdbc.sql("select count(*) from products").query(Long.class).single());
        out.put("knowledgeChunks", jdbc.sql("select count(*) from vector_store").query(Long.class).single());
        return out;
    }

    /** Round-trips one chat and one embedding call to NVIDIA. Off unless DEV_ENDPOINTS_ENABLED=true. */
    @GetMapping("/ai")
    public Map<String, Object> ai() {
        if (!devEndpointsEnabled) {
            throw new NotFoundException("AI health check is disabled");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        long t0 = System.currentTimeMillis();
        String reply = fastChatClient.prompt()
                .user("Reply with exactly the word OK.")
                .call()
                .content();
        out.put("chatModel", aiProperties.fastModel());
        out.put("chatReply", reply);
        out.put("chatLatencyMs", System.currentTimeMillis() - t0);

        long t1 = System.currentTimeMillis();
        float[] vector = embeddingModel.embed("Can I return an opened laptop?");
        out.put("embeddingModel", aiProperties.embedding().model());
        out.put("embeddingDimensions", vector.length);
        out.put("embeddingLatencyMs", System.currentTimeMillis() - t1);
        return out;
    }
}
