package com.shopsmart.ops;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.shopsmart.common.BusinessException;
import com.shopsmart.common.NotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Operations data and human-approved actions (stock transfers, promotions). */
@Service
public class OpsService {

    private final JdbcClient jdbc;

    public OpsService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------ KPIs

    public Map<String, Object> kpis() {
        Map<String, Object> k = new LinkedHashMap<>();
        jdbc.sql("""
                        select count(*) filter (where created_at::date = current_date) as orders_today,
                               coalesce(sum(total) filter (where created_at::date = current_date and status <> 'CANCELLED'), 0) as revenue_today,
                               count(*) filter (where status in ('PLACED','PACKED','SHIPPED','OUT_FOR_DELIVERY')) as open_orders,
                               count(*) filter (where status = 'RETURN_REQUESTED') as returns_pending
                        from orders
                        """)
                .query((rs, n) -> {
                    k.put("ordersToday", rs.getLong(1));
                    k.put("revenueToday", rs.getBigDecimal(2));
                    k.put("openOrders", rs.getLong(3));
                    k.put("returnsPending", rs.getLong(4));
                    return null;
                }).list();
        k.put("delayedShipments", jdbc.sql("""
                        select count(*) from shipments s join orders o on o.id = s.order_id
                        where s.delayed and o.status in ('SHIPPED','OUT_FOR_DELIVERY')
                        """).query(Long.class).single());
        jdbc.sql("""
                        select count(*) as total,
                               count(*) filter (where confidence = 'LOW') as low,
                               count(*) filter (where error is not null) as fallbacks,
                               coalesce(avg(latency_ms), 0)::int as avg_latency
                        from ai_audit_log where created_at >= now() - interval '24 hours'
                        """)
                .query((rs, n) -> {
                    k.put("aiAnswers24h", rs.getLong(1));
                    k.put("lowConfidence24h", rs.getLong(2));
                    k.put("aiFallbacks24h", rs.getLong(3));
                    k.put("aiAvgLatencyMs", rs.getInt(4));
                    return null;
                }).list();
        jdbc.sql("select count(*) filter (where rating = 1), count(*) from ai_feedback")
                .query((rs, n) -> {
                    k.put("helpfulVotes", rs.getLong(1));
                    k.put("totalVotes", rs.getLong(2));
                    return null;
                }).list();
        k.put("ordersByDay", jdbc.sql("""
                        select d::date as day, count(o.id) as orders, coalesce(sum(o.total) filter (where o.status <> 'CANCELLED'), 0) as revenue
                        from generate_series(current_date - 13, current_date, interval '1 day') d
                        left join orders o on o.created_at::date = d::date
                        group by d order by d
                        """)
                .query((rs, n) -> Map.of("day", rs.getObject(1, LocalDate.class), "orders", rs.getLong(2), "revenue", rs.getBigDecimal(3)))
                .list());
        k.put("aiByAgent", jdbc.sql("""
                        select agent, count(*) from ai_audit_log where created_at >= now() - interval '7 days' group by agent order by count(*) desc
                        """)
                .query((rs, n) -> Map.of("agent", rs.getString(1), "count", rs.getLong(2))).list());
        return k;
    }

    // ------------------------------------------------------------------ fulfilment issues

    public List<Map<String, Object>> issues() {
        return jdbc.sql("""
                        select o.id, o.status, u.name as customer, u.membership_tier as tier, s.carrier, s.eta, o.promised_date,
                               (select note from shipment_events e where e.shipment_id = s.id order by occurred_at desc, id desc limit 1) as last_event,
                               case when s.delayed then 'DELAYED_IN_TRANSIT'
                                    when o.status in ('PLACED','PACKED') and o.created_at < now() - interval '2 days' then 'NOT_DISPATCHED'
                                    else 'PAST_PROMISED_DATE' end as issue
                        from orders o join users u on u.id = o.user_id join shipments s on s.order_id = o.id
                        where o.status in ('PLACED','PACKED','SHIPPED','OUT_FOR_DELIVERY')
                          and (s.delayed or (o.status in ('PLACED','PACKED') and o.created_at < now() - interval '2 days')
                               or o.promised_date < current_date)
                        order by o.created_at
                        """)
                .query((rs, n) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("orderId", rs.getString("id"));
                    m.put("status", rs.getString("status"));
                    m.put("customer", rs.getString("customer"));
                    m.put("tier", rs.getString("tier"));
                    m.put("carrier", rs.getString("carrier"));
                    m.put("eta", rs.getObject("eta", LocalDate.class));
                    m.put("promisedDate", rs.getObject("promised_date", LocalDate.class));
                    m.put("lastEvent", rs.getString("last_event"));
                    m.put("issue", rs.getString("issue"));
                    boolean member = !"BASIC".equals(rs.getString("tier"));
                    m.put("suggestedAction", member
                            ? "Notify the customer; Prime/Premium late deliveries get a $5 Wallet credit (Delivery SLA by Region › Late Delivery Compensation)."
                            : "Notify the customer with the new ETA.");
                    return m;
                })
                .list();
    }

    // ------------------------------------------------------------------ transfers

    @Transactional
    public Map<String, Object> transfer(String productId, String from, String to, int quantity, UUID approvedBy) {
        if (from.equals(to)) throw new IllegalArgumentException("Source and destination must differ");
        if (quantity <= 0 || quantity > 1000) throw new IllegalArgumentException("Quantity must be 1-1000");
        int moved = jdbc.sql("""
                        update inventory set on_hand = on_hand - :q, updated_at = now()
                        where product_id = :p and warehouse_id = :f and on_hand - reserved >= :q
                        """)
                .param("q", quantity).param("p", productId).param("f", from).update();
        if (moved == 0) throw new BusinessException(HttpStatus.CONFLICT, "INSUFFICIENT_STOCK", from + " no longer has " + quantity + " units to spare");
        int landed = jdbc.sql("update inventory set on_hand = on_hand + :q, updated_at = now() where product_id = :p and warehouse_id = :t")
                .param("q", quantity).param("p", productId).param("t", to).update();
        if (landed == 0) throw new NotFoundException("No inventory record for " + productId + " at " + to);
        jdbc.sql("insert into stock_movements (product_id, warehouse_id, delta, reason) values (:p, :f, :d, 'TRANSFER_OUT')")
                .param("p", productId).param("f", from).param("d", -quantity).update();
        jdbc.sql("insert into stock_movements (product_id, warehouse_id, delta, reason) values (:p, :t, :d, 'TRANSFER_IN')")
                .param("p", productId).param("t", to).param("d", quantity).update();
        return Map.of("productId", productId, "from", from, "to", to, "quantity", quantity, "approvedBy", approvedBy.toString());
    }

    // ------------------------------------------------------------------ promotions

    public List<Map<String, Object>> promotions() {
        return jdbc.sql("""
                        select pr.id, pr.code, pr.description, pr.type, pr.value, pr.product_id, p.name as product_name, pr.starts_at, pr.ends_at,
                               pr.status, pr.created_by, pr.rationale, pr.created_at
                        from promotions pr left join products p on p.id = pr.product_id order by pr.created_at desc
                        """)
                .query((rs, n) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getObject("id", UUID.class));
                    m.put("code", rs.getString("code"));
                    m.put("description", rs.getString("description"));
                    m.put("type", rs.getString("type"));
                    m.put("value", rs.getBigDecimal("value"));
                    m.put("productId", rs.getString("product_id"));
                    m.put("productName", rs.getString("product_name"));
                    m.put("startsAt", rs.getObject("starts_at", OffsetDateTime.class));
                    m.put("endsAt", rs.getObject("ends_at", OffsetDateTime.class));
                    m.put("status", rs.getString("status"));
                    m.put("createdBy", rs.getString("created_by"));
                    m.put("rationale", rs.getString("rationale"));
                    return m;
                })
                .list();
    }

    /** Saves an agent or human suggestion as a DRAFT; nothing changes for shoppers until it is activated. */
    public UUID createDraft(String productId, BigDecimal percent, int days, String rationale, String createdBy) {
        if (percent.compareTo(BigDecimal.ONE) < 0 || percent.compareTo(BigDecimal.valueOf(50)) > 0) {
            throw new IllegalArgumentException("Discount must be 1-50%");
        }
        String name = jdbc.sql("select name from products where id = upper(:p)").param("p", productId).query(String.class).optional()
                .orElseThrow(() -> new NotFoundException("Product " + productId + " not found"));
        String code = ("SAVE" + percent.intValue() + "-" + productId).toUpperCase();
        return jdbc.sql("""
                        insert into promotions (code, description, type, value, product_id, starts_at, ends_at, status, created_by, rationale)
                        values (:code, :desc, 'PERCENT', :v, upper(:p), now(), now() + make_interval(days => :days), 'DRAFT', :by, :why)
                        on conflict (code) do update set rationale = excluded.rationale
                        returning id
                        """)
                .param("code", code).param("desc", percent.intValue() + "% off " + name).param("v", percent).param("p", productId)
                .param("days", days).param("by", createdBy).param("why", rationale)
                .query(UUID.class).single();
    }

    public void setPromotionStatus(UUID id, String status) {
        int n = jdbc.sql("update promotions set status = :s where id = :id").param("s", status).param("id", id).update();
        if (n == 0) throw new NotFoundException("Promotion not found");
    }

    // ------------------------------------------------------------------ audit

    public List<Map<String, Object>> auditLog(String agent, String confidence, boolean errorsOnly, int limit) {
        return jdbc.sql("""
                        select a.id, a.agent, a.intent, a.input, a.confidence, a.model, a.latency_ms, a.error, a.created_at,
                               u.email, (a.prompt_tokens + coalesce(a.completion_tokens, 0)) as tokens,
                               (select rating from ai_feedback f where f.audit_id = a.id limit 1) as rating
                        from ai_audit_log a left join users u on u.id = a.user_id
                        where (cast(:agent as text) is null or a.agent = :agent)
                          and (cast(:conf as text) is null or a.confidence = :conf)
                          and (not :errors or a.error is not null)
                        order by a.created_at desc limit :limit
                        """)
                .param("agent", agent).param("conf", confidence).param("errors", errorsOnly).param("limit", limit)
                .query((rs, n) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getObject("id", UUID.class));
                    m.put("agent", rs.getString("agent"));
                    m.put("intent", rs.getString("intent"));
                    m.put("input", rs.getString("input"));
                    m.put("confidence", rs.getString("confidence"));
                    m.put("model", rs.getString("model"));
                    m.put("latencyMs", rs.getInt("latency_ms"));
                    m.put("fallback", rs.getString("error"));
                    m.put("user", rs.getString("email"));
                    m.put("tokens", rs.getObject("tokens"));
                    m.put("rating", rs.getObject("rating"));
                    m.put("createdAt", rs.getObject("created_at", OffsetDateTime.class));
                    return m;
                })
                .list();
    }
}
