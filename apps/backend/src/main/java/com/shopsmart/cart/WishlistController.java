package com.shopsmart.cart;

import java.util.List;
import java.util.UUID;

import com.shopsmart.catalog.CatalogDtos.ProductSummary;
import com.shopsmart.catalog.CatalogRepository;
import com.shopsmart.common.NotFoundException;
import com.shopsmart.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/wishlist")
public class WishlistController {

    private final JdbcClient jdbc;
    private final CatalogRepository catalog;

    public WishlistController(JdbcClient jdbc, CatalogRepository catalog) {
        this.jdbc = jdbc;
        this.catalog = catalog;
    }

    @GetMapping
    public List<ProductSummary> list(@AuthenticationPrincipal Jwt jwt) {
        List<String> ids = ids(CurrentUser.from(jwt).id());
        if (ids.isEmpty()) return List.of();
        List<ProductSummary> products = catalog.findByIds(ids);
        // keep most-recently-added first
        return ids.stream().flatMap(id -> products.stream().filter(p -> p.id().equals(id))).toList();
    }

    @GetMapping("/ids")
    public List<String> listIds(@AuthenticationPrincipal Jwt jwt) {
        return ids(CurrentUser.from(jwt).id());
    }

    @PutMapping("/{productId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void add(@AuthenticationPrincipal Jwt jwt, @PathVariable String productId) {
        if (catalog.findByIds(List.of(productId)).isEmpty()) {
            throw new NotFoundException("Product '" + productId + "' not found");
        }
        jdbc.sql("insert into wishlists (user_id, product_id) values (:u, upper(:p)) on conflict do nothing")
                .param("u", CurrentUser.from(jwt).id()).param("p", productId).update();
    }

    @DeleteMapping("/{productId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@AuthenticationPrincipal Jwt jwt, @PathVariable String productId) {
        jdbc.sql("delete from wishlists where user_id = :u and product_id = upper(:p)")
                .param("u", CurrentUser.from(jwt).id()).param("p", productId).update();
    }

    private List<String> ids(UUID userId) {
        return jdbc.sql("select product_id from wishlists where user_id = :u order by created_at desc")
                .param("u", userId).query(String.class).list();
    }
}
