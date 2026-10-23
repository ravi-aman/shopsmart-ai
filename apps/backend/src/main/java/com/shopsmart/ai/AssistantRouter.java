package com.shopsmart.ai;

import java.util.Locale;
import java.util.Set;

import org.springframework.stereotype.Component;

/**
 * Decides which agent handles a message. Deterministic on purpose: routing must be instant and
 * auditable. Policy vocabulary sends a message to the knowledge agent unless it is clearly a buying
 * request ("suggest", "under $…", "best").
 */
@Component
public class AssistantRouter {

    public enum Agent { SHOPPING, KNOWLEDGE }

    private static final Set<String> POLICY = Set.of(
            "return", "returns", "returnable", "returned", "refund", "refunds", "warranty", "guarantee", "cancel", "cancellation",
            "cancelled", "shipping", "ship", "shipped", "shipment", "delivery", "deliver", "delivered", "membership", "member",
            "prime", "premium", "policy", "policies", "exchange", "replacement", "replace", "seller", "sellers", "sla",
            "manual", "setup", "ports", "claim", "repair", "fee", "fees");

    private static final Set<String> SHOPPING = Set.of(
            "suggest", "recommend", "recommendation", "best", "buy", "looking", "need", "want", "cheap", "budget", "under",
            "below", "compare", "options", "show", "find", "gift", "top");

    public Agent route(String message, boolean hasProductContext) {
        String q = message.toLowerCase(Locale.ROOT);
        int policy = 0;
        int shopping = 0;
        for (String w : q.split("[^a-z0-9$]+")) {
            if (POLICY.contains(w)) policy++;
            if (SHOPPING.contains(w)) shopping++;
        }
        if (q.contains("$")) shopping++;
        if (policy == 0) return Agent.SHOPPING;
        if (hasProductContext || shopping == 0) return Agent.KNOWLEDGE;
        return policy >= shopping ? Agent.KNOWLEDGE : Agent.SHOPPING;
    }
}
