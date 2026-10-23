package com.shopsmart.customer;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonIgnore;

public record UserAccount(
        UUID id,
        String name,
        String email,
        @JsonIgnore String passwordHash,
        String role,
        String membershipTier,
        String region,
        OffsetDateTime createdAt) {
}
