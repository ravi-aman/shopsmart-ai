package com.shopsmart.ai.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "shopsmart.ai")
public record AiProperties(String fastModel, Embedding embedding) {

    public record Embedding(
            String baseUrl,
            String apiKey,
            String model,
            int dimensions,
            boolean sendDimensions,
            int batchSize) {
    }
}
