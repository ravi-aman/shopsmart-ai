package com.shopsmart.cart;

import java.util.List;

import com.shopsmart.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cart")
public class CartController {

    private final CartService cart;

    public CartController(CartService cart) {
        this.cart = cart;
    }

    @GetMapping
    public CartService.CartView get(@AuthenticationPrincipal Jwt jwt) {
        return cart.view(CurrentUser.from(jwt).id());
    }

    /** Sets the quantity of one product; 0 removes it. */
    @PutMapping("/items/{productId}")
    public CartService.CartView setQuantity(@AuthenticationPrincipal Jwt jwt, @PathVariable String productId,
                                            @Valid @RequestBody QuantityRequest req) {
        return cart.setQuantity(CurrentUser.from(jwt).id(), productId, req.quantity());
    }

    @DeleteMapping("/items/{productId}")
    public CartService.CartView remove(@AuthenticationPrincipal Jwt jwt, @PathVariable String productId) {
        return cart.setQuantity(CurrentUser.from(jwt).id(), productId, 0);
    }

    /** Merges a guest cart kept in the browser into the signed-in user's cart. */
    @PostMapping("/merge")
    public CartService.CartView merge(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody MergeRequest req) {
        return cart.merge(CurrentUser.from(jwt).id(), req.items());
    }

    public record QuantityRequest(@NotNull @Min(0) @Max(CartService.MAX_QUANTITY) Integer quantity) {
    }

    public record MergeRequest(@NotNull @Size(max = 50) List<@Valid MergeItem> items) {
    }

    public record MergeItem(@NotBlank String productId, @Min(1) @Max(CartService.MAX_QUANTITY) int quantity) {
    }
}
