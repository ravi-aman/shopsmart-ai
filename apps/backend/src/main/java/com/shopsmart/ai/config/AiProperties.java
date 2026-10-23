package com.shopsmart.ai.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "shopsmart.ai")
public record AiProperties(String fastModel, String agentModel, Embedding embedding) {

    /** False when NVIDIA_API_KEY is not set; the assistant then runs its deterministic pipeline only. */
    public boolean nvidiaConfigured() {
        String key = embedding.apiKey();
        return key != null && !key.isBlank() && !key.equals("missing-key") && !key.startsWith("nvapi-xxxx");
    }

    public record Embedding(
            String baseUrl,
            String apiKey,
            String model,
            int dimensions,
            boolean sendDimensions,
            int batchSize) {
    }
}
