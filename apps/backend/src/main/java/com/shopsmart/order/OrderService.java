package com.shopsmart.order;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.shopsmart.cart.CartService;
import com.shopsmart.common.BusinessException;
import com.shopsmart.common.Json;
import com.shopsmart.common.NotFoundException;
import com.shopsmart.order.OrderDtos.Address;
import com.shopsmart.order.OrderDtos.CancelInfo;
import com.shopsmart.order.OrderDtos.Event;
import com.shopsmart.order.OrderDtos.OrderDetail;
import com.shopsmart.order.OrderDtos.OrderItem;
import com.shopsmart.order.OrderDtos.OrderSummary;
import com.shopsmart.order.OrderDtos.Policy;
import com.shopsmart.order.OrderDtos.Quote;
import com.shopsmart.order.OrderDtos.ReturnInfo;
import com.shopsmart.order.OrderDtos.Shipment;
import com.shopsmart.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Simulated order lifecycle: quote → checkout (stock reserved) → shipment events → cancel / return under policy rules. */
@Service
public class OrderService {

    public static final List<String> FLOW = List.of("PLACED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED");
    private static final String[] CARRIERS = {"BlueDart", "Delhivery", "Ekart", "XpressBees"};

    private final JdbcClient jdbc;
    private final CartService cart;
    private final Json json;

    public OrderService(JdbcClient jdbc, CartService cart, Json json) {
        this.jdbc = jdbc;
        this.cart = cart;
        this.json = json;
    }

    // ------------------------------------------------------------------ quote + checkout

    record Line(String productId, String name, int quantity, BigDecimal price) {
    }

    record Warehouse(String id, String city, String region) {
    }

    public Quote quote(CurrentUser user, String region) {
        List<Line> lines = cartLines(user.id());
        Warehouse wh = chooseWarehouse(lines, region);
        BigDecimal subtotal = lines.stream().map(l -> l.price().multiply(BigDecimal.valueOf(l.quantity()))).reduce(BigDecimal.ZERO, BigDecimal::add);
        var fee = OrderRules.shippingFee(user.tier(), subtotal);
        return new Quote(subtotal, fee.amount(), subtotal.add(fee.amount()), fee.explanation(), policy(fee.source()), wh.id(), wh.city(),
                OrderRules.promisedDate(LocalDate.now(ZoneOffset.UTC), region, wh.region()), !region.equals(wh.region()),
                lines.stream().mapToInt(Line::quantity).sum());
    }

    @Transactional
    public OrderDetail checkout(CurrentUser user, Address address) {
        List<Line> lines = cartLines(user.id());
        Warehouse wh = chooseWarehouse(lines, address.region());
        for (Line l : lines) {
            int updated = jdbc.sql("""
                            update inventory set on_hand = on_hand - :q, updated_at = now()
                            where product_id = :p and warehouse_id = :w and on_hand - reserved >= :q
                            """)
                    .param("q", l.quantity()).param("p", l.productId()).param("w", wh.id()).update();
            if (updated == 0) {
                throw new BusinessException(HttpStatus.CONFLICT, "INSUFFICIENT_STOCK", l.name() + " just went out of stock. Please review your cart.");
            }
            movement(l.productId(), wh.id(), -l.quantity(), "SALE");
        }
        BigDecimal subtotal = lines.stream().map(l -> l.price().multiply(BigDecimal.valueOf(l.quantity()))).reduce(BigDecimal.ZERO, BigDecimal::add);
        var fee = OrderRules.shippingFee(user.tier(), subtotal);
        LocalDate promised = OrderRules.promisedDate(LocalDate.now(ZoneOffset.UTC), address.region(), wh.region());

        long n = jdbc.sql("select nextval('order_number_seq')").query(Long.class).single();
        String orderId = "ORD-" + n;
        jdbc.sql("""
                        insert into orders (id, user_id, status, subtotal, shipping_fee, total, shipping_address, warehouse_id, promised_date)
                        values (:id, :u, 'PLACED', :sub, :fee, :total, cast(:addr as jsonb), :wh, :promised)
                        """)
                .param("id", orderId).param("u", user.id()).param("sub", subtotal).param("fee", fee.amount())
                .param("total", subtotal.add(fee.amount())).param("addr", json.write(address)).param("wh", wh.id())
                .param("promised", promised).update();
        for (Line l : lines) {
            jdbc.sql("insert into order_items (order_id, product_id, quantity, unit_price) values (:o, :p, :q, :price)")
                    .param("o", orderId).param("p", l.productId()).param("q", l.quantity()).param("price", l.price()).update();
        }
        String shipmentId = "SHP-" + n;
        String carrier = CARRIERS[(int) (n % CARRIERS.length)];
        jdbc.sql("insert into shipments (id, order_id, carrier, tracking_no, eta) values (:id, :o, :c, :t, :eta)")
                .param("id", shipmentId).param("o", orderId).param("c", carrier)
                .param("t", carrier.substring(0, 2).toUpperCase() + (7_000_000_000L + n * 7919)).param("eta", promised).update();
        event(shipmentId, "PLACED", wh.city(), "Order confirmed");
        jdbc.sql("delete from cart_items where cart_id = (select id from carts where user_id = :u)").param("u", user.id()).update();
        return detail(orderId, user);
    }

    private List<Line> cartLines(UUID userId) {
        var view = cart.view(userId);
        if (view.items().isEmpty()) throw new BusinessException(HttpStatus.CONFLICT, "EMPTY_CART", "Your cart is empty");
        return view.items().stream().map(i -> new Line(i.productId(), i.product().name(), i.quantity(), i.product().price())).toList();
    }

    /** One fulfilment centre must hold every line: prefer the shopper's region, then the one with most stock. */
    private Warehouse chooseWarehouse(List<Line> lines, String region) {
        Map<String, Object> params = new HashMap<>();
        StringBuilder needs = new StringBuilder();
        for (int i = 0; i < lines.size(); i++) {
            if (i > 0) needs.append(" and ");
            needs.append("exists (select 1 from inventory i where i.warehouse_id = w.id and i.product_id = :p").append(i)
                    .append(" and i.on_hand - i.reserved >= :q").append(i).append(")");
            params.put("p" + i, lines.get(i).productId());
            params.put("q" + i, lines.get(i).quantity());
        }
        params.put("region", region);
        return jdbc.sql("select w.id, w.city, w.region from warehouses w where " + needs
                        + " order by (w.region = :region) desc, (select sum(on_hand) from inventory i where i.warehouse_id = w.id) desc limit 1")
                .params(params)
                .query((rs, n) -> new Warehouse(rs.getString(1), rs.getString(2), rs.getString(3)))
                .optional()
                .orElseThrow(() -> new BusinessException(HttpStatus.CONFLICT, "SPLIT_FULFILMENT",
                        "No single fulfilment centre has every item in stock. Remove an item or order it separately."));
    }

    // ------------------------------------------------------------------ read

    public List<OrderSummary> list(UUID userId) {
        return jdbc.sql("""
                        select o.id, o.status, o.total, o.currency, o.promised_date, o.created_at,
                               (select sum(quantity) from order_items oi where oi.order_id = o.id) as item_count,
                               (select p.name from order_items oi join products p on p.id = oi.product_id where oi.order_id = o.id order by p.price desc limit 1) as first_name,
                               (select p.images ->> 0 from order_items oi join products p on p.id = oi.product_id where oi.order_id = o.id order by p.price desc limit 1) as first_image
                        from orders o where o.user_id = :u order by o.created_at desc
                        """)
                .param("u", userId)
                .query((rs, n) -> new OrderSummary(rs.getString("id"), rs.getString("status"), rs.getBigDecimal("total"), rs.getString("currency"),
                        rs.getInt("item_count"), rs.getString("first_name"), rs.getString("first_image"),
                        rs.getObject("promised_date", LocalDate.class), rs.getObject("created_at", OffsetDateTime.class)))
                .list();
    }

    /** Latest order that is not finished, else the latest order — what "my order" usually means. */
    public Optional<String> currentOrderId(UUID userId) {
        return jdbc.sql("""
                        select id from orders where user_id = :u
                        order by (status in ('DELIVERED','CANCELLED','RETURNED','REFUNDED')) asc, created_at desc limit 1
                        """)
                .param("u", userId).query(String.class).optional();
    }

    public OrderDetail detail(String orderId, CurrentUser user) {
        record Row(String id, UUID userId, String status, BigDecimal subtotal, BigDecimal fee, BigDecimal total, String currency,
                   String address, String warehouseId, String warehouseCity, LocalDate promised, OffsetDateTime created, OffsetDateTime delivered) {
        }
        Row o = jdbc.sql("""
                        select o.id, o.user_id, o.status, o.subtotal, o.shipping_fee, o.total, o.currency, o.shipping_address::text,
                               o.warehouse_id, w.city, o.promised_date, o.created_at, o.delivered_at
                        from orders o left join warehouses w on w.id = o.warehouse_id where o.id = upper(:id)
                        """)
                .param("id", orderId)
                .query((rs, n) -> new Row(rs.getString(1), rs.getObject(2, UUID.class), rs.getString(3), rs.getBigDecimal(4), rs.getBigDecimal(5),
                        rs.getBigDecimal(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10),
                        rs.getObject(11, LocalDate.class), rs.getObject(12, OffsetDateTime.class), rs.getObject(13, OffsetDateTime.class)))
                .optional()
                .filter(r -> user == null || "ADMIN".equals(user.role()) || "OPS".equals(user.role()) || r.userId().equals(user.id()))
                .orElseThrow(() -> new NotFoundException("Order " + orderId + " not found"));

        Map<String, String> requested = new HashMap<>();
        jdbc.sql("select product_id, status from return_requests where order_id = :o").param("o", o.id())
                .query((rs, n) -> Map.entry(rs.getString(1), rs.getString(2))).list()
                .forEach(e -> requested.put(e.getKey(), e.getValue()));

        List<OrderItem> items = jdbc.sql("""
                        select oi.product_id, p.name, p.slug, p.images ->> 0, b.name, c.name, oi.quantity, oi.unit_price, c.path
                        from order_items oi join products p on p.id = oi.product_id join brands b on b.id = p.brand_id
                        join categories c on c.id = p.category_id where oi.order_id = :o order by oi.unit_price desc
                        """)
                .param("o", o.id())
                .query((rs, n) -> new OrderItem(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                        rs.getString(6), rs.getInt(7), rs.getBigDecimal(8), returnInfo(o.status(), o.delivered(), rs.getString(9), requested.get(rs.getString(1)))))
                .list();

        Shipment shipment = jdbc.sql("select id, carrier, tracking_no, eta, delayed from shipments where order_id = :o").param("o", o.id())
                .query((rs, n) -> new Shipment(rs.getString(1), rs.getString(2), rs.getString(3), rs.getObject(4, LocalDate.class),
                        rs.getBoolean(5), events(rs.getString(1))))
                .optional().orElse(null);

        boolean canCancel = OrderRules.CANCELLABLE.contains(o.status());
        var cancelRef = OrderRules.cancelPolicyFor(o.status());
        String cancelReason = canCancel ? "Not shipped yet — you can cancel free of charge."
                : switch (o.status()) {
                    case "SHIPPED" -> "Already shipped — it can't be cancelled. You can refuse the delivery or return it after it arrives.";
                    case "OUT_FOR_DELIVERY" -> "Out for delivery — it can't be cancelled. Refuse the delivery or return it instead.";
                    case "CANCELLED" -> "This order is already cancelled.";
                    default -> "Delivered orders can't be cancelled — request a return instead.";
                };
        return new OrderDetail(o.id(), o.status(), o.subtotal(), o.fee(), o.total(), o.currency(), json.read(o.address(), Address.class),
                o.warehouseId(), o.warehouseCity(), o.promised(), o.created(), o.delivered(), items, shipment,
                new CancelInfo(canCancel, cancelReason, policy(cancelRef)));
    }

    private ReturnInfo returnInfo(String status, OffsetDateTime deliveredAt, String categoryPath, String existingRequest) {
        var window = OrderRules.returnWindow(categoryPath);
        Policy p = policy(window.source());
        if (existingRequest != null) return new ReturnInfo(false, null, "Return " + existingRequest.toLowerCase(), p, existingRequest);
        if (deliveredAt == null || !("DELIVERED".equals(status) || "RETURN_REQUESTED".equals(status))) {
            return new ReturnInfo(false, null, "Returns open after delivery", p, null);
        }
        if (window.days() == 0) return new ReturnInfo(false, null, "This item is not returnable", p, null);
        LocalDate deadline = deliveredAt.toLocalDate().plusDays(window.days());
        boolean open = !LocalDate.now(ZoneOffset.UTC).isAfter(deadline);
        return new ReturnInfo(open, deadline,
                open ? "Returnable until " + deadline + " (" + window.days() + "-day window)" : "Return window closed on " + deadline, p, null);
    }

    private List<Event> events(String shipmentId) {
        return jdbc.sql("select status, location, note, occurred_at from shipment_events where shipment_id = :s order by occurred_at, id")
                .param("s", shipmentId)
                .query((rs, n) -> new Event(rs.getString(1), rs.getString(2), rs.getString(3), rs.getObject(4, OffsetDateTime.class)))
                .list();
    }

    // ------------------------------------------------------------------ actions

    @Transactional
    public OrderDetail cancel(String orderId, CurrentUser user) {
        OrderDetail o = detail(orderId, user);
        if (!o.cancel().allowed()) throw new BusinessException(HttpStatus.CONFLICT, "CANNOT_CANCEL", o.cancel().reason());
        int updated = jdbc.sql("update orders set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = :o and status in ('PLACED','PACKED')")
                .param("o", o.id()).update();
        if (updated == 0) throw new BusinessException(HttpStatus.CONFLICT, "CANNOT_CANCEL", "The order changed status — please refresh");
        for (OrderItem i : o.items()) {
            jdbc.sql("update inventory set on_hand = on_hand + :q, updated_at = now() where product_id = :p and warehouse_id = :w")
                    .param("q", i.quantity()).param("p", i.productId()).param("w", o.warehouseId()).update();
            movement(i.productId(), o.warehouseId(), i.quantity(), "CANCELLATION");
        }
        if (o.shipment() != null) event(o.shipment().id(), "CANCELLED", o.warehouseCity(), "Cancelled by customer; refund initiated");
        return detail(orderId, user);
    }

    @Transactional
    public OrderDetail requestReturn(String orderId, CurrentUser user, String productId, String reason) {
        OrderDetail o = detail(orderId, user);
        OrderItem item = o.items().stream().filter(i -> i.productId().equalsIgnoreCase(productId)).findFirst()
                .orElseThrow(() -> new NotFoundException("That item is not in order " + o.id()));
        if (!item.returnInfo().eligible()) throw new BusinessException(HttpStatus.CONFLICT, "NOT_RETURNABLE", item.returnInfo().reason());
        Map<String, Object> ref = new LinkedHashMap<>();
        ref.put("document", item.returnInfo().policy().document());
        ref.put("section", item.returnInfo().policy().section());
        ref.put("version", item.returnInfo().policy().version());
        ref.put("deadline", String.valueOf(item.returnInfo().deadline()));
        jdbc.sql("insert into return_requests (order_id, product_id, reason, policy_reference) values (:o, :p, :r, cast(:ref as jsonb))")
                .param("o", o.id()).param("p", item.productId()).param("r", reason.trim()).param("ref", json.write(ref)).update();
        long remaining = o.items().stream().filter(i -> !i.productId().equals(item.productId()) && i.returnInfo().requestStatus() == null).count();
        if (remaining == 0) {
            jdbc.sql("update orders set status = 'RETURN_REQUESTED', updated_at = now() where id = :o").param("o", o.id()).update();
        }
        if (o.shipment() != null) event(o.shipment().id(), "RETURN_REQUESTED", o.address().city(), "Return requested for " + item.name());
        return detail(orderId, user);
    }

    /** Moves an order one step along the delivery flow (simulator and admin "advance" button). */
    @Transactional
    public Optional<String> advance(String orderId) {
        record S(String status, String shipmentId, String whCity, String custCity) {
        }
        S s = jdbc.sql("""
                        select o.status, sh.id, w.city, o.shipping_address ->> 'city'
                        from orders o join shipments sh on sh.order_id = o.id left join warehouses w on w.id = o.warehouse_id
                        where o.id = upper(:o)
                        """)
                .param("o", orderId).query((rs, n) -> new S(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)))
                .optional().orElseThrow(() -> new NotFoundException("Order " + orderId + " not found"));
        int idx = FLOW.indexOf(s.status());
        if (idx < 0 || idx == FLOW.size() - 1) return Optional.empty();
        String next = FLOW.get(idx + 1);
        jdbc.sql("update orders set status = :s, updated_at = now()" + ("DELIVERED".equals(next) ? ", delivered_at = now()" : "") + " where id = upper(:o)")
                .param("s", next).param("o", orderId).update();
        switch (next) {
            case "PACKED" -> event(s.shipmentId(), next, s.whCity(), "Packed at fulfilment centre");
            case "SHIPPED" -> {
                event(s.shipmentId(), next, s.whCity(), "Handed to carrier");
                // deterministic ~1 in 4 orders hit a hub delay, so ops has issues to work on
                if (Math.floorMod(orderId.hashCode(), 4) == 0) {
                    event(s.shipmentId(), "DELAYED", "Regional sorting hub", "Delayed at sorting hub — expected +2 days");
                    jdbc.sql("update shipments set delayed = true, eta = eta + 2 where id = :s").param("s", s.shipmentId()).update();
                }
            }
            case "OUT_FOR_DELIVERY" -> event(s.shipmentId(), next, s.custCity(), "Out for delivery with courier");
            case "DELIVERED" -> event(s.shipmentId(), next, s.custCity(), "Delivered to customer");
            default -> {
            }
        }
        return Optional.of(next);
    }

    public List<String> ordersDueForAdvance(int minAgeSeconds) {
        return jdbc.sql("""
                        select o.id from orders o join shipments sh on sh.order_id = o.id
                        where o.status in ('PLACED','PACKED','SHIPPED','OUT_FOR_DELIVERY')
                          and (select max(occurred_at) from shipment_events e where e.shipment_id = sh.id) < now() - make_interval(secs => :age)
                        """)
                .param("age", minAgeSeconds).query(String.class).list();
    }

    // ------------------------------------------------------------------ helpers

    private void event(String shipmentId, String status, String location, String note) {
        jdbc.sql("insert into shipment_events (shipment_id, status, location, note) values (:s, :st, :l, :n)")
                .param("s", shipmentId).param("st", status).param("l", location).param("n", note).update();
    }

    private void movement(String productId, String warehouseId, int delta, String reason) {
        jdbc.sql("insert into stock_movements (product_id, warehouse_id, delta, reason) values (:p, :w, :d, :r)")
                .param("p", productId).param("w", warehouseId).param("d", delta).param("r", reason).update();
    }

    /** Resolves a policy rule to the active document version so citations are exact. */
    Policy policy(OrderRules.PolicyRef ref) {
        String version = jdbc.sql("select version from documents where title = :t and is_active limit 1").param("t", ref.document())
                .query(String.class).optional().orElse(null);
        return new Policy(ref.document(), ref.section(), version);
    }
}
