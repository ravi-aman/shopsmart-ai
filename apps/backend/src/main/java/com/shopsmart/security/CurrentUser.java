package com.shopsmart.security;

import java.util.UUID;

import org.springframework.security.oauth2.jwt.Jwt;

/** Identity extracted from the JWT of the current request. */
public record CurrentUser(UUID id, String email, String role, String tier, String region) {

    public static CurrentUser from(Jwt jwt) {
        var roles = jwt.getClaimAsStringList("roles");
        return new CurrentUser(
                UUID.fromString(jwt.getSubject()),
                jwt.getClaimAsString("email"),
                roles == null || roles.isEmpty() ? "CUSTOMER" : roles.getFirst(),
                jwt.getClaimAsString("tier"),
                jwt.getClaimAsString("region"));
    }
}
