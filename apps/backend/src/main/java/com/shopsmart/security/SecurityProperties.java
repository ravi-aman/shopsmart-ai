package com.shopsmart.security;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "shopsmart")
public record SecurityProperties(Security security, Cors cors) {

    public record Security(String jwtSecret, long jwtTtlMinutes) {
    }

    public record Cors(List<String> allowedOrigins) {
    }
}
