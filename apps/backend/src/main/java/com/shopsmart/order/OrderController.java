package com.shopsmart.order;

import java.util.List;
import java.util.Map;

import com.shopsmart.common.NotFoundException;
import com.shopsmart.order.OrderDtos.CheckoutRequest;
import com.shopsmart.order.OrderDtos.OrderDetail;
import com.shopsmart.order.OrderDtos.OrderSummary;
import com.shopsmart.order.OrderDtos.Quote;
import com.shopsmart.order.OrderDtos.QuoteRequest;
import com.shopsmart.order.OrderDtos.ReturnRequest;
import com.shopsmart.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {

    private final OrderService orders;
    private final JdbcClient jdbc;

    public OrderController(OrderService orders, JdbcClient jdbc) {
        this.orders = orders;
        this.jdbc = jdbc;
    }

    @PostMapping("/api/orders/quote")
    public Quote quote(@Valid @RequestBody QuoteRequest req, @AuthenticationPrincipal Jwt jwt) {
        return orders.quote(CurrentUser.from(jwt), req.region());
    }

    /** Payment is out of scope: placing the order reserves stock and creates the shipment. */
    @PostMapping("/api/orders/checkout")
    @ResponseStatus(HttpStatus.CREATED)
    public OrderDetail checkout(@Valid @RequestBody CheckoutRequest req, @AuthenticationPrincipal Jwt jwt) {
        return orders.checkout(CurrentUser.from(jwt), req.address());
    }

    @GetMapping("/api/orders")
    public List<OrderSummary> list(@AuthenticationPrincipal Jwt jwt) {
        return orders.list(CurrentUser.from(jwt).id());
    }

    @GetMapping("/api/orders/{id}")
    public OrderDetail detail(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        return orders.detail(id, CurrentUser.from(jwt));
    }

    @PostMapping("/api/orders/{id}/cancel")
    public OrderDetail cancel(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        return orders.cancel(id, CurrentUser.from(jwt));
    }

    @PostMapping("/api/orders/{id}/returns")
    public OrderDetail requestReturn(@PathVariable String id, @Valid @RequestBody ReturnRequest req, @AuthenticationPrincipal Jwt jwt) {
        return orders.requestReturn(id, CurrentUser.from(jwt), req.productId(), req.reason());
    }

    // ------------------------------------------------------------------ admin

    @GetMapping("/api/admin/orders")
    @PreAuthorize("hasAnyRole('ADMIN', 'OPS')")
    public List<Map<String, Object>> all(@RequestParam(required = false) String status) {
        return jdbc.sql("""
                        select o.id, o.status, o.total, o.created_at, o.promised_date, u.name as customer, u.membership_tier as tier,
                               o.warehouse_id, sh.carrier, sh.delayed, sh.eta,
                               (select sum(quantity) from order_items oi where oi.order_id = o.id) as items
                        from orders o join users u on u.id = o.user_id left join shipments sh on sh.order_id = o.id
                        where (cast(:status as text) is null or o.status = :status)
                        order by o.created_at desc limit 200
                        """)
                .param("status", status)
                .query((rs, n) -> {
                    Map<String, Object> m = new java.util.LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("status", rs.getString("status"));
                    m.put("total", rs.getBigDecimal("total"));
                    m.put("createdAt", rs.getObject("created_at", java.time.OffsetDateTime.class));
                    m.put("promisedDate", rs.getObject("promised_date", java.time.LocalDate.class));
                    m.put("eta", rs.getObject("eta", java.time.LocalDate.class));
                    m.put("customer", rs.getString("customer"));
                    m.put("tier", rs.getString("tier"));
                    m.put("warehouseId", rs.getString("warehouse_id"));
                    m.put("carrier", rs.getString("carrier"));
                    m.put("delayed", rs.getBoolean("delayed"));
                    m.put("items", rs.getInt("items"));
                    return m;
                })
                .list();
    }

    /** Demo control: move an order to its next delivery status now. */
    @PostMapping("/api/admin/orders/{id}/advance")
    @PreAuthorize("hasAnyRole('ADMIN', 'OPS')")
    public Map<String, Object> advance(@PathVariable String id) {
        String next = orders.advance(id).orElseThrow(() -> new NotFoundException("Order " + id + " has no next status"));
        return Map.of("id", id.toUpperCase(), "status", next);
    }
}
