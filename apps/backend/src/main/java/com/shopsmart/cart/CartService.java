package com.shopsmart.cart;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import com.shopsmart.catalog.CatalogDtos.ProductSummary;
import com.shopsmart.catalog.CatalogRepository;
import com.shopsmart.common.BusinessException;
import com.shopsmart.common.NotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CartService {

    public static final int MAX_QUANTITY = 20;

    private final JdbcClient jdbc;
    private final CatalogRepository catalog;

    public CartService(JdbcClient jdbc, CatalogRepository catalog) {
        this.jdbc = jdbc;
        this.catalog = catalog;
    }

    @Transactional(readOnly = true)
    public CartView view(UUID userId) {
        List<CartLine> lines = jdbc.sql("""
                        select ci.product_id, ci.quantity from cart_items ci join carts c on c.id = ci.cart_id
                        where c.user_id = :u order by ci.added_at
                        """)
                .param("u", userId)
                .query((rs, n) -> new CartLine(rs.getString(1), rs.getInt(2), null, null))
                .list();
        if (lines.isEmpty()) return new CartView(List.of(), 0, BigDecimal.ZERO, BigDecimal.ZERO);

        var products = catalog.findByIds(lines.stream().map(CartLine::productId).toList());
        List<CartLine> items = lines.stream()
                .flatMap(l -> products.stream().filter(p -> p.id().equals(l.productId())).findFirst()
                        .map(p -> new CartLine(p.id(), l.quantity(), p, p.price().multiply(BigDecimal.valueOf(l.quantity()))))
                        .stream())
                .toList();
        int count = items.stream().mapToInt(CartLine::quantity).sum();
        BigDecimal subtotal = items.stream().map(CartLine::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal savings = items.stream()
                .filter(i -> i.product().mrp() != null)
                .map(i -> i.product().mrp().subtract(i.product().price()).multiply(BigDecimal.valueOf(i.quantity())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new CartView(items, count, subtotal, savings);
    }

    @Transactional
    public CartView setQuantity(UUID userId, String productId, int quantity) {
        UUID cartId = cartId(userId);
        if (quantity <= 0) {
            jdbc.sql("delete from cart_items where cart_id = :c and product_id = upper(:p)")
                    .param("c", cartId).param("p", productId).update();
        } else {
            ProductSummary product = requireAvailable(productId, quantity);
            jdbc.sql("""
                            insert into cart_items (cart_id, product_id, quantity, price_snapshot) values (:c, :p, :q, :price)
                            on conflict (cart_id, product_id) do update set quantity = excluded.quantity, price_snapshot = excluded.price_snapshot
                            """)
                    .param("c", cartId).param("p", product.id()).param("q", quantity).param("price", product.price())
                    .update();
        }
        touch(cartId);
        return view(userId);
    }

    /** Adds guest quantities on top of the saved cart, capped at stock and MAX_QUANTITY. Unknown products are skipped. */
    @Transactional
    public CartView merge(UUID userId, List<CartController.MergeItem> items) {
        UUID cartId = cartId(userId);
        for (var item : items) {
            var found = catalog.findByIds(List.of(item.productId()));
            if (found.isEmpty() || found.getFirst().availableQuantity() <= 0) continue;
            ProductSummary p = found.getFirst();
            int cap = (int) Math.min(MAX_QUANTITY, p.availableQuantity());
            jdbc.sql("""
                            insert into cart_items (cart_id, product_id, quantity, price_snapshot) values (:c, :p, least(:q, :cap), :price)
                            on conflict (cart_id, product_id) do update
                            set quantity = least(cart_items.quantity + excluded.quantity, :cap), price_snapshot = excluded.price_snapshot
                            """)
                    .param("c", cartId).param("p", p.id()).param("q", item.quantity()).param("cap", cap).param("price", p.price())
                    .update();
        }
        touch(cartId);
        return view(userId);
    }

    private ProductSummary requireAvailable(String productId, int quantity) {
        var found = catalog.findByIds(List.of(productId));
        if (found.isEmpty()) throw new NotFoundException("Product '" + productId + "' not found");
        ProductSummary p = found.getFirst();
        if (p.availableQuantity() <= 0) {
            throw new BusinessException(HttpStatus.CONFLICT, "OUT_OF_STOCK", p.name() + " is out of stock");
        }
        if (quantity > p.availableQuantity()) {
            throw new BusinessException(HttpStatus.CONFLICT, "INSUFFICIENT_STOCK",
                    "Only " + p.availableQuantity() + " of " + p.name() + " available");
        }
        return p;
    }

    private UUID cartId(UUID userId) {
        return jdbc.sql("""
                        insert into carts (user_id) values (:u)
                        on conflict (user_id) do update set updated_at = now()
                        returning id
                        """)
                .param("u", userId)
                .query(UUID.class)
                .single();
    }

    private void touch(UUID cartId) {
        jdbc.sql("update carts set updated_at = now() where id = :c").param("c", cartId).update();
    }

    public record CartLine(String productId, int quantity, ProductSummary product, BigDecimal lineTotal) {
    }

    public record CartView(List<CartLine> items, int itemCount, BigDecimal subtotal, BigDecimal savings) {
    }
}
