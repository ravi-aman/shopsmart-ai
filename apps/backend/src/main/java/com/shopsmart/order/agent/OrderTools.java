package com.shopsmart.order.agent;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.shopsmart.common.Json;
import com.shopsmart.knowledge.KnowledgeAnswerService;
import com.shopsmart.knowledge.KnowledgeDtos.AnswerResponse;
import com.shopsmart.order.OrderDtos.OrderDetail;
import com.shopsmart.order.OrderDtos.OrderItem;
import com.shopsmart.order.OrderService;
import com.shopsmart.security.CurrentUser;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;

/**
 * Tools the order agent may call, scoped to one signed-in shopper and one request. Read-only:
 * cancel/return are only <em>proposed</em> here and recorded for the UI's confirmation card — the
 * actual change goes through the normal REST endpoints after the shopper confirms.
 */
public class OrderTools {

    public record ProposedAction(String type, String orderId, String productId, String productName, boolean allowed, String reason,
                                 String policyDocument, String policySection, String policyVersion) {
    }

    private final CurrentUser user;
    private final OrderService orders;
    private final KnowledgeAnswerService knowledge;
    private final Json json;

    final List<Map<String, Object>> calls = new ArrayList<>();
    final List<ProposedAction> actions = new ArrayList<>();
    final Map<String, OrderDetail> ordersSeen = new LinkedHashMap<>();
    AnswerResponse policyAnswer;

    public OrderTools(CurrentUser user, OrderService orders, KnowledgeAnswerService knowledge, Json json) {
        this.user = user;
        this.orders = orders;
        this.knowledge = knowledge;
        this.json = json;
    }

    @Tool(description = "List the shopper's recent orders with status and total")
    public String listMyOrders() {
        var list = orders.list(user.id()).stream().limit(5).toList();
        log("listMyOrders", Map.of(), list.size() + " orders");
        return json.write(list);
    }

    @Tool(description = "Get one order's status, items, shipment tracking events and estimated delivery date")
    public String getOrderStatus(@ToolParam(description = "Order id such as ORD-100001") String orderId) {
        OrderDetail o = load(orderId);
        Map<String, Object> facts = new LinkedHashMap<>();
        facts.put("orderId", o.id());
        facts.put("status", o.status());
        facts.put("items", o.items().stream().map(i -> i.name() + " x" + i.quantity()).toList());
        facts.put("estimatedDelivery", o.shipment() == null ? o.promisedDate() : o.shipment().eta());
        facts.put("delayed", o.shipment() != null && o.shipment().delayed());
        facts.put("carrier", o.shipment() == null ? null : o.shipment().carrier());
        facts.put("latestEvents", o.shipment() == null ? List.of() : o.shipment().events().stream()
                .skip(Math.max(0, o.shipment().events().size() - 3)).map(e -> e.status() + " at " + e.location() + ": " + e.note()).toList());
        log("getOrderStatus", Map.of("orderId", orderId), o.status());
        return json.write(facts);
    }

    @Tool(description = "Check whether an order can be cancelled now, under the cancellation policy. Proposes the action for the shopper to confirm; does not cancel.")
    public String checkCancellation(@ToolParam(description = "Order id such as ORD-100001") String orderId) {
        OrderDetail o = load(orderId);
        var c = o.cancel();
        propose(new ProposedAction("CANCEL", o.id(), null, null, c.allowed(), c.reason(), c.policy().document(), c.policy().section(), c.policy().version()));
        log("checkCancellation", Map.of("orderId", orderId), c.allowed() ? "allowed" : "not allowed");
        return json.write(Map.of("allowed", c.allowed(), "reason", c.reason(), "policy", c.policy()));
    }

    @Tool(description = "Check whether items in an order can be returned now and until when. Proposes a return for the shopper to confirm; does not create it.")
    public String checkReturn(@ToolParam(description = "Order id such as ORD-100001") String orderId,
                              @ToolParam(description = "Product id to return, or empty for the most valuable item", required = false) String productId) {
        OrderDetail o = load(orderId);
        OrderItem item = o.items().stream()
                .filter(i -> productId == null || productId.isBlank() || i.productId().equalsIgnoreCase(productId))
                .findFirst().orElse(o.items().getFirst());
        var r = item.returnInfo();
        propose(new ProposedAction("RETURN", o.id(), item.productId(), item.name(), r.eligible(), r.reason(),
                r.policy().document(), r.policy().section(), r.policy().version()));
        log("checkReturn", Map.of("orderId", orderId, "productId", item.productId()), r.eligible() ? "eligible" : "not eligible");
        return json.write(Map.of("product", item.name(), "eligible", r.eligible(), "reason", r.reason(),
                "deadline", String.valueOf(r.deadline()), "policy", r.policy()));
    }

    @Tool(description = "Answer a policy question (returns, refunds, cancellation, delivery, warranty, membership) from approved ShopSmart documents, with sources")
    public String lookupPolicy(@ToolParam(description = "The policy question in plain words") String question) {
        policyAnswer = knowledge.answer(question, null, null, user, step -> {});
        log("lookupPolicy", Map.of("question", question), policyAnswer.confidence());
        return json.write(Map.of("answer", policyAnswer.answer(), "confidence", policyAnswer.confidence(), "sources", policyAnswer.sources()));
    }

    OrderDetail load(String orderId) {
        return ordersSeen.computeIfAbsent(orderId.trim().toUpperCase(), id -> orders.detail(id, user));
    }

    private void propose(ProposedAction a) {
        actions.removeIf(x -> x.type().equals(a.type()) && x.orderId().equals(a.orderId()));
        actions.add(a);
    }

    private void log(String tool, Map<String, Object> args, String result) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("tool", tool);
        m.put("args", args);
        m.put("result", result);
        calls.add(m);
    }
}
