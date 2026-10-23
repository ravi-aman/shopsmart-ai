package com.shopsmart.ai;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.shopsmart.common.Json;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Writes and reads ai_audit_log: every AI decision with its inputs, tool steps, output and cost. */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final JdbcClient jdbc;
    private final Json json;

    public AuditService(JdbcClient jdbc, Json json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public record Entry(
            String conversationId,
            UUID userId,
            String agent,
            String intent,
            String input,
            Object extractedParams,
            List<?> toolCalls,
            List<String> retrievedIds,
            Object output,
            String confidence,
            String model,
            Integer promptTokens,
            Integer completionTokens,
            int latencyMs,
            String error) {
    }

    /** Never throws: an audit failure must not break the user's answer. Returns null if the write failed. */
    public UUID record(Entry e) {
        try {
            return jdbc.sql("""
                            insert into ai_audit_log (conversation_id, user_id, agent, intent, input, extracted_params, tool_calls,
                                retrieved_chunk_ids, output, confidence, model, prompt_tokens, completion_tokens, latency_ms, error)
                            values (:conv, :user, :agent, :intent, :input, cast(:params as jsonb), cast(:tools as jsonb),
                                :ids, cast(:output as jsonb), :confidence, :model, :pt, :ct, :latency, :error)
                            returning id
                            """)
                    .param("conv", e.conversationId())
                    .param("user", e.userId())
                    .param("agent", e.agent())
                    .param("intent", e.intent())
                    .param("input", e.input())
                    .param("params", json.write(e.extractedParams()))
                    .param("tools", json.write(e.toolCalls()))
                    .param("ids", e.retrievedIds().toArray(String[]::new))
                    .param("output", json.write(e.output()))
                    .param("confidence", e.confidence())
                    .param("model", e.model())
                    .param("pt", e.promptTokens())
                    .param("ct", e.completionTokens())
                    .param("latency", e.latencyMs())
                    .param("error", e.error())
                    .query(UUID.class)
                    .single();
        } catch (RuntimeException ex) {
            log.error("Could not write AI audit entry", ex);
            return null;
        }
    }

    public Optional<Map<String, Object>> find(UUID id) {
        return jdbc.sql("""
                        select id, user_id, agent, intent, input, extracted_params::text as extracted_params, tool_calls::text as tool_calls,
                               retrieved_chunk_ids, output::text as output, confidence, model, prompt_tokens, completion_tokens,
                               latency_ms, error, created_at
                        from ai_audit_log where id = :id
                        """)
                .param("id", id)
                .query((rs, n) -> {
                    Map<String, Object> m = new java.util.LinkedHashMap<>();
                    m.put("id", rs.getObject("id", UUID.class));
                    m.put("userId", rs.getObject("user_id", UUID.class));
                    m.put("agent", rs.getString("agent"));
                    m.put("intent", rs.getString("intent"));
                    m.put("input", rs.getString("input"));
                    m.put("extractedParams", json.read(rs.getString("extracted_params")));
                    m.put("toolCalls", json.read(rs.getString("tool_calls")));
                    m.put("retrievedIds", List.of((String[]) rs.getArray("retrieved_chunk_ids").getArray()));
                    m.put("output", json.read(rs.getString("output")));
                    m.put("confidence", rs.getString("confidence"));
                    m.put("model", rs.getString("model"));
                    m.put("promptTokens", rs.getObject("prompt_tokens"));
                    m.put("completionTokens", rs.getObject("completion_tokens"));
                    m.put("latencyMs", rs.getObject("latency_ms"));
                    m.put("error", rs.getString("error"));
                    m.put("createdAt", rs.getObject("created_at", java.time.OffsetDateTime.class));
                    return m;
                })
                .optional();
    }

    public void feedback(UUID auditId, UUID userId, int rating, String comment) {
        jdbc.sql("""
                        insert into ai_feedback (audit_id, user_id, rating, comment) values (:a, :u, :r, :c)
                        on conflict (audit_id, user_id) do update set rating = excluded.rating, comment = excluded.comment, created_at = now()
                        """)
                .param("a", auditId).param("u", userId).param("r", rating).param("c", comment)
                .update();
    }
}
