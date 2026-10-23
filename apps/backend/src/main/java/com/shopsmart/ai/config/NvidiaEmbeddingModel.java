package com.shopsmart.ai.config;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.ai.document.Document;
import org.springframework.ai.embedding.Embedding;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.embedding.EmbeddingRequest;
import org.springframework.ai.embedding.EmbeddingResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;

/**
 * Spring AI {@link EmbeddingModel} for NVIDIA retrieval embedders (build.nvidia.com).
 *
 * NVIDIA's QA embedders are asymmetric and require an {@code input_type} field that the
 * OpenAI client never sends: stored chunks are embedded as {@code passage}, user questions
 * as {@code query}. {@link #embed(String)} is what vector stores call for a search query,
 * so it is the one path that uses {@code query}.
 */
public class NvidiaEmbeddingModel implements EmbeddingModel {

    public enum InputType { query, passage }

    private final RestClient restClient;
    private final AiProperties.Embedding props;

    public NvidiaEmbeddingModel(RestClient.Builder builder, AiProperties.Embedding props) {
        this.props = props;
        this.restClient = builder
                .baseUrl(props.baseUrl())
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + props.apiKey())
                .build();
    }

    @Override
    public EmbeddingResponse call(EmbeddingRequest request) {
        return embedBatched(request.getInstructions(), InputType.passage);
    }

    @Override
    public float[] embed(String text) {
        return embedBatched(List.of(text), InputType.query).getResult().getOutput();
    }

    @Override
    public float[] embed(Document document) {
        return embedBatched(List.of(document.getFormattedContent()), InputType.passage).getResult().getOutput();
    }

    @Override
    public int dimensions() {
        // Avoids the default implementation, which makes a network call at startup.
        return props.dimensions();
    }

    public EmbeddingResponse embedBatched(List<String> texts, InputType inputType) {
        List<Embedding> embeddings = new ArrayList<>(texts.size());
        int batchSize = Math.max(1, props.batchSize());
        for (int start = 0; start < texts.size(); start += batchSize) {
            List<String> batch = texts.subList(start, Math.min(texts.size(), start + batchSize));
            NvidiaEmbeddingResponse response = request(batch, inputType);
            for (NvidiaEmbeddingResponse.Item item : response.data()) {
                float[] vector = toFloatArray(item.embedding());
                if (vector.length != props.dimensions()) {
                    throw new IllegalStateException("Embedding model " + props.model() + " returned " + vector.length
                            + " dimensions but EMBEDDING_DIMENSIONS is " + props.dimensions());
                }
                embeddings.add(new Embedding(vector, start + item.index()));
            }
        }
        return new EmbeddingResponse(embeddings);
    }

    private NvidiaEmbeddingResponse request(List<String> batch, InputType inputType) {
        Map<String, Object> body = new HashMap<>();
        body.put("model", props.model());
        body.put("input", batch);
        body.put("input_type", inputType.name());
        body.put("encoding_format", "float");
        body.put("truncate", "END");
        if (props.sendDimensions()) {
            body.put("dimensions", props.dimensions());
        }
        return restClient.post()
                .uri("/v1/embeddings")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(NvidiaEmbeddingResponse.class);
    }

    private static float[] toFloatArray(List<Double> values) {
        float[] out = new float[values.size()];
        for (int i = 0; i < out.length; i++) {
            out[i] = values.get(i).floatValue();
        }
        return out;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record NvidiaEmbeddingResponse(List<Item> data, Usage usage) {

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Item(int index, List<Double> embedding) {
        }

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Usage(@JsonProperty("prompt_tokens") int promptTokens, @JsonProperty("total_tokens") int totalTokens) {
        }
    }
}
