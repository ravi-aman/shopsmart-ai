package com.shopsmart.customer;

import java.util.Set;

import com.shopsmart.common.BusinessException;
import com.shopsmart.security.TokenService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    static final Set<String> REGIONS = Set.of("IN-WEST", "IN-NORTH", "IN-SOUTH", "IN-EAST");

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokens;

    public AuthController(UserRepository users, PasswordEncoder passwordEncoder, TokenService tokens) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.tokens = tokens;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthResponse register(@Valid @RequestBody RegisterRequest req) {
        if (users.findByEmail(req.email()).isPresent()) {
            throw new BusinessException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "An account with this email already exists");
        }
        String region = req.region() == null ? "IN-WEST" : req.region();
        if (!REGIONS.contains(region)) {
            throw new IllegalArgumentException("Unknown region " + region);
        }
        UserAccount user = users.insert(req.name().trim(), req.email().trim(),
                passwordEncoder.encode(req.password()), "CUSTOMER", "BASIC", region);
        return new AuthResponse(tokens.issue(user), user);
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest req) {
        UserAccount user = users.findByEmail(req.email().trim())
                .filter(u -> passwordEncoder.matches(req.password(), u.passwordHash()))
                .orElseThrow(() -> new BusinessException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS",
                        "Email or password is incorrect"));
        return new AuthResponse(tokens.issue(user), user);
    }

    public record RegisterRequest(
            @NotBlank @Size(max = 120) String name,
            @NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(min = 8, max = 72, message = "must be 8–72 characters") String password,
            String region) {
    }

    public record LoginRequest(@NotBlank @Email String email, @NotBlank String password) {
    }

    public record AuthResponse(String token, UserAccount user) {
    }
}
