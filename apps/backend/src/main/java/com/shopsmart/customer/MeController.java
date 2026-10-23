package com.shopsmart.customer;

import java.math.BigDecimal;
import java.util.List;

import com.shopsmart.common.NotFoundException;
import com.shopsmart.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me")
public class MeController {

    private final UserRepository users;

    public MeController(UserRepository users) {
        this.users = users;
    }

    @GetMapping
    public UserAccount me(@AuthenticationPrincipal Jwt jwt) {
        return users.findById(CurrentUser.from(jwt).id())
                .orElseThrow(() -> new NotFoundException("User no longer exists"));
    }

    @GetMapping("/preferences")
    public UserRepository.Preferences preferences(@AuthenticationPrincipal Jwt jwt) {
        return users.findPreferences(CurrentUser.from(jwt).id());
    }

    @PutMapping("/preferences")
    public UserRepository.Preferences updatePreferences(@AuthenticationPrincipal Jwt jwt,
                                                        @Valid @RequestBody PreferencesRequest req) {
        if (req.budgetMin() != null && req.budgetMax() != null && req.budgetMin().compareTo(req.budgetMax()) > 0) {
            throw new IllegalArgumentException("budgetMin must not exceed budgetMax");
        }
        var prefs = new UserRepository.Preferences(req.preferredCategories(), req.preferredBrands(),
                req.useCases(), req.budgetMin(), req.budgetMax());
        users.upsertPreferences(CurrentUser.from(jwt).id(), prefs);
        return prefs;
    }

    public record PreferencesRequest(
            @NotNull @Size(max = 20) List<@Size(max = 80) String> preferredCategories,
            @NotNull @Size(max = 20) List<@Size(max = 120) String> preferredBrands,
            @NotNull @Size(max = 10) List<@Size(max = 80) String> useCases,
            @DecimalMin("0") BigDecimal budgetMin,
            @DecimalMin("0") BigDecimal budgetMax) {
    }
}
