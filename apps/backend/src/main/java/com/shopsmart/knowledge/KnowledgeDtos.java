package com.shopsmart.knowledge;

import java.util.List;
import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class KnowledgeDtos {

    private KnowledgeDtos() {
    }

    public record AskRequest(
            @NotBlank @Size(max = 500) String question,
            @Size(max = 20) String productId,
            @Size(max = 64) String conversationId) {
    }

    /** The brief's contract: answer, confidence, sources, followUpRequired. Later fields are additive. */
    public record AnswerResponse(
            String answer,
            String confidence,
            List<Source> sources,
            boolean followUpRequired,
            List<Citation> citations,
            List<String> notices,
            UUID auditId,
            boolean aiAssisted) {
    }

    public record Source(String document, String section, String version) {
    }

    public record Citation(int n, UUID chunkId, UUID documentId, String document, String section, String version,
                           String effectiveDate, String snippet) {
    }
}
