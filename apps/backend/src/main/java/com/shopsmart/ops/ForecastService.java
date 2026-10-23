package com.shopsmart.ops;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Deterministic stock-out forecast: 14-day average daily sales per product and warehouse, days of
 * cover = available / velocity, compared with the replenishment lead time. The recommendation
 * prefers a transfer from a centre with surplus over a supplier reorder.
 */
@Service
public class ForecastService {

    static final int VELOCITY_WINDOW_DAYS = 14;
    static final int LEAD_TIME_DAYS = 7;
    static final int TARGET_COVER_DAYS = 30;
    static final int SURPLUS_COVER_DAYS = 45;

    public enum Risk { OUT_OF_STOCK, CRITICAL, LOW, OK, OVERSTOCK }

    public record StockPosition(String productId, String productName, String category, String warehouseId, String city,
                                int available, double dailySales, Double daysOfCover, Risk risk) {
    }

    public record Recommendation(String type, String productId, String productName, String fromWarehouse, String toWarehouse,
                                 int quantity, String rationale) {
    }

    public record RiskRow(StockPosition position, Recommendation recommendation) {
    }

    private final JdbcClient jdbc;

    public ForecastService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<StockPosition> positions() {
        return jdbc.sql("""
                        select i.product_id, p.name, c.name as category, i.warehouse_id, w.city,
                               greatest(i.on_hand - i.reserved, 0) as available,
                               coalesce((select -sum(m.delta) from stock_movements m
                                         where m.product_id = i.product_id and m.warehouse_id = i.warehouse_id
                                           and m.reason = 'SALE' and m.created_at >= now() - make_interval(days => :win)), 0)::float8 / :win as velocity
                        from inventory i
                        join products p on p.id = i.product_id and p.status = 'ACTIVE'
                        join categories c on c.id = p.category_id
                        join warehouses w on w.id = i.warehouse_id
                        """)
                .param("win", VELOCITY_WINDOW_DAYS)
                .query((rs, n) -> {
                    int available = rs.getInt("available");
                    double v = rs.getDouble("velocity");
                    Double cover = v > 0 ? available / v : null;
                    return new StockPosition(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                            available, round(v), cover == null ? null : round(cover), risk(available, v, cover));
                })
                .list();
    }

    static Risk risk(int available, double velocity, Double cover) {
        if (velocity <= 0) return available > 60 ? Risk.OVERSTOCK : Risk.OK;
        if (available == 0) return Risk.OUT_OF_STOCK;
        if (cover < LEAD_TIME_DAYS) return Risk.CRITICAL;
        if (cover < 2 * LEAD_TIME_DAYS) return Risk.LOW;
        if (cover > 90 && available > 40) return Risk.OVERSTOCK;
        return Risk.OK;
    }

    /** At-risk positions (out of stock, critical, low) with a recommended fix, most urgent first. */
    public List<RiskRow> risks() {
        List<StockPosition> all = positions();
        Map<String, List<StockPosition>> byProduct = new HashMap<>();
        all.forEach(p -> byProduct.computeIfAbsent(p.productId(), k -> new ArrayList<>()).add(p));

        List<RiskRow> out = new ArrayList<>();
        for (StockPosition p : all) {
            if (p.risk() != Risk.OUT_OF_STOCK && p.risk() != Risk.CRITICAL && p.risk() != Risk.LOW) continue;
            int needed = (int) Math.ceil(p.dailySales() * TARGET_COVER_DAYS) - p.available();
            if (needed <= 0) continue;
            // a donor keeps at least SURPLUS_COVER_DAYS of its own demand
            StockPosition donor = byProduct.get(p.productId()).stream()
                    .filter(o -> !o.warehouseId().equals(p.warehouseId()))
                    .filter(o -> surplus(o) > 0)
                    .max(Comparator.comparingInt(ForecastService::surplus))
                    .orElse(null);
            Recommendation rec;
            if (donor != null) {
                int qty = Math.min(needed, surplus(donor));
                rec = new Recommendation("TRANSFER", p.productId(), p.productName(), donor.warehouseId(), p.warehouseId(), qty,
                        donor.city() + " has " + donor.available() + " units (" + (donor.daysOfCover() == null ? "no recent sales" : donor.daysOfCover() + " days of cover")
                                + "); moving " + qty + " restores about " + TARGET_COVER_DAYS + " days of cover in " + p.city() + ".");
            } else {
                rec = new Recommendation("REORDER", p.productId(), p.productName(), null, p.warehouseId(), needed,
                        "No centre has surplus; reorder " + needed + " units from the supplier (lead time " + LEAD_TIME_DAYS + " days).");
            }
            out.add(new RiskRow(p, rec));
        }
        // most urgent first; within a risk level, the fastest sellers lose the most sales
        out.sort(Comparator.comparingInt((RiskRow r) -> r.position().risk().ordinal())
                .thenComparing(r -> -r.position().dailySales()));
        return out;
    }

    /** Products with lots of stock and slow sales across the network — candidates for a promotion. */
    public List<Map<String, Object>> overstock(int limit) {
        return jdbc.sql("""
                        with stock as (
                            select i.product_id, sum(greatest(i.on_hand - i.reserved, 0)) as available from inventory i group by i.product_id
                        ), sales as (
                            select product_id, -sum(delta)::float8 / :win as velocity from stock_movements
                            where reason = 'SALE' and created_at >= now() - make_interval(days => :win) group by product_id
                        )
                        select p.id, p.name, c.name as category, p.price, s.available, coalesce(v.velocity, 0) as velocity
                        from stock s join products p on p.id = s.product_id join categories c on c.id = p.category_id
                        left join sales v on v.product_id = s.product_id
                        where p.status = 'ACTIVE' and s.available >= 80
                          and (coalesce(v.velocity, 0) = 0 or s.available / v.velocity > 60)
                          and not exists (select 1 from promotions pr where pr.product_id = p.id and pr.status in ('DRAFT', 'ACTIVE'))
                        order by s.available / greatest(coalesce(v.velocity, 0), 0.1) desc
                        limit :limit
                        """)
                .param("win", VELOCITY_WINDOW_DAYS).param("limit", limit)
                .query((rs, n) -> {
                    Map<String, Object> m = new java.util.LinkedHashMap<>();
                    double v = rs.getDouble("velocity");
                    int available = rs.getInt("available");
                    m.put("productId", rs.getString("id"));
                    m.put("productName", rs.getString("name"));
                    m.put("category", rs.getString("category"));
                    m.put("price", rs.getBigDecimal("price"));
                    m.put("available", available);
                    m.put("dailySales", round(v));
                    m.put("daysOfCover", v > 0 ? round(available / v) : null);
                    return m;
                })
                .list();
    }

    private static int surplus(StockPosition p) {
        int keep = (int) Math.ceil(p.dailySales() * SURPLUS_COVER_DAYS);
        return Math.max(0, p.available() - Math.max(keep, 5));
    }

    private static double round(double v) {
        return BigDecimal.valueOf(v).setScale(1, RoundingMode.HALF_UP).doubleValue();
    }
}
