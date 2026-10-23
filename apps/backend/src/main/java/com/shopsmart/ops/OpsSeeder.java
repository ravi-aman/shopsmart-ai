package com.shopsmart.ops;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Generates 60 days of deterministic sales history per product and warehouse so the stock-out
 * forecast has real velocity to work with. Runs once (when there is no sales history yet).
 */
@Component
@Order(3)
public class OpsSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(OpsSeeder.class);

    private final JdbcClient jdbc;

    public OpsSeeder(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        long history = jdbc.sql("select count(*) from stock_movements where reason = 'SALE' and created_at < now() - interval '1 day'")
                .query(Long.class).single();
        if (history > 0) return;
        // Sell-through is proportional to stock (well-run centres hold ~1-3 months of cover), with ~1 in 40
        // positions a "hot" item selling 3-8 units almost daily — those are the ones the forecast should flag. Empty
        // positions mostly have no recent sales; 1 in 10 sold out recently.
        int rows = jdbc.sql("""
                        insert into stock_movements (product_id, warehouse_id, delta, reason, created_at)
                        select i.product_id, i.warehouse_id,
                               -case when abs(hashtext(i.product_id || i.warehouse_id || 'hot')) % 40 = 0
                                     then 3 + abs(hashtext(i.product_id || i.warehouse_id || d::text || 'q')) % 6
                                     else 1 + abs(hashtext(i.product_id || i.warehouse_id || d::text || 'q')) % 3 end,
                               'SALE',
                               now() - make_interval(days => d) + make_interval(mins => abs(hashtext(i.product_id || d::text)) % 600)
                        from inventory i
                        cross join generate_series(1, 60) as d
                        where abs(hashtext(i.product_id || i.warehouse_id || d::text)) % 100 <
                              case when i.on_hand = 0
                                   then case when abs(hashtext(i.product_id || i.warehouse_id || 'sold-out')) % 10 = 0 then 30 else 0 end
                                   when abs(hashtext(i.product_id || i.warehouse_id || 'hot')) % 40 = 0 then 90
                                   else least(60, greatest(2, i.on_hand * (20 + abs(hashtext(i.product_id || i.warehouse_id || 'k')) % 60) / 120))
                              end
                        """)
                .update();
        log.info("Seeded {} days of sales history ({} movements) for forecasting", 60, rows);
        seedOrderHistory();
    }

    /** Two weeks of delivered orders for the demo customers, so dashboards and the order agent have history. */
    private void seedOrderHistory() {
        long existing = jdbc.sql("select count(*) from orders").query(Long.class).single();
        if (existing > 0) return;
        // Rows inserted by one CTE are invisible to the others, so ids and picks are fixed up front.
        int orders = jdbc.sql("""
                        with picks as materialized (
                            select 'ORD-' || nextval('order_number_seq') as order_id, d,
                                   (select id from users where role = 'CUSTOMER' order by id offset abs(hashtext(d::text || k::text)) % 3 limit 1) as user_id,
                                   (select id from products where status = 'ACTIVE' order by id offset abs(hashtext(k::text || d::text || 'p')) % 200 limit 1) as product_id,
                                   (select id from warehouses order by id offset abs(hashtext(d::text || k::text || 'w')) % 5 limit 1) as warehouse_id
                            from generate_series(1, 13) d
                            cross join generate_series(1, 6) k
                            where k <= 1 + abs(hashtext(d::text || 'n')) % 6
                        ), ins as (
                            insert into orders (id, user_id, status, subtotal, shipping_fee, total, shipping_address, warehouse_id,
                                                promised_date, created_at, updated_at, delivered_at)
                            select pk.order_id, pk.user_id, 'DELIVERED', p.price, 0, p.price,
                                   jsonb_build_object('name', u.name, 'line1', '1 Demo Street', 'city', w.city, 'pincode', '400001',
                                                      'region', w.region, 'phone', '+91 90000 00000'),
                                   pk.warehouse_id, (now() - make_interval(days => pk.d - 2))::date,
                                   now() - make_interval(days => pk.d), now() - make_interval(days => pk.d - 2),
                                   now() - make_interval(days => pk.d - 2)
                            from picks pk join products p on p.id = pk.product_id join users u on u.id = pk.user_id
                            join warehouses w on w.id = pk.warehouse_id
                            returning id
                        ), items as (
                            insert into order_items (order_id, product_id, quantity, unit_price)
                            select pk.order_id, pk.product_id, 1, p.price from picks pk join products p on p.id = pk.product_id
                            returning order_id
                        ), ships as (
                            insert into shipments (id, order_id, carrier, tracking_no, eta)
                            select 'SHP-' || substr(pk.order_id, 5), pk.order_id, 'Delhivery', 'DE' || substr(pk.order_id, 5),
                                   (now() - make_interval(days => pk.d - 2))::date
                            from picks pk
                            returning id
                        )
                        insert into shipment_events (shipment_id, status, location, note, occurred_at)
                        select 'SHP-' || substr(pk.order_id, 5), 'DELIVERED', 'Customer address', 'Delivered to customer',
                               now() - make_interval(days => pk.d - 2)
                        from picks pk
                        """)
                .update();
        log.info("Seeded {} historical orders", orders);
    }
}
