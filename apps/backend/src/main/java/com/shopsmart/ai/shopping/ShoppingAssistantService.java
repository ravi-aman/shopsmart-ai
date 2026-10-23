package com.shopsmart.ai.shopping;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

import com.shopsmart.ai.AuditService;
import com.shopsmart.ai.config.AiProperties;
import com.shopsmart.ai.config.NvidiaEmbeddingModel;
import com.shopsmart.ai.shopping.CandidateRepository.Constraints;
import com.shopsmart.ai.shopping.ShoppingDtos.Interpretation;
import com.shopsmart.ai.shopping.ShoppingDtos.Recommendation;
import com.shopsmart.ai.shopping.ShoppingDtos.RecommendResponse;
import com.shopsmart.ai.shopping.ShoppingDtos.Step;
import com.shopsmart.customer.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Module 1 pipeline: understand → retrieve (SQL + hybrid) → score (deterministic) → explain (LLM, validated)
 * → audit. Each stage reports progress so the UI can show what the assistant is doing.
 */
@Service
public class ShoppingAssistantService {

    private static final Logger log = LoggerFactory.getLogger(ShoppingAssistantService.class);
    static final int MAX_RECOMMENDATIONS = 3;
    static final int CANDIDATES = 20;

    private final IntentExtractor extractor;
    private final CandidateRepository candidates;
    private final SpecScorer scorer;
    private final ReasonWriter writer;
    private final AuditService audit;
    private final UserRepository users;
    private final NvidiaEmbeddingModel embeddings;
    private final AiProperties ai;

    public ShoppingAssistantService(IntentExtractor extractor, CandidateRepository candidates, SpecScorer scorer,
                                    ReasonWriter writer, AuditService audit, UserRepository users,
                                    NvidiaEmbeddingModel embeddings, AiProperties ai) {
        this.extractor = extractor;
        this.candidates = candidates;
        this.scorer = scorer;
        this.writer = writer;
        this.audit = audit;
        this.users = users;
        this.embeddings = embeddings;
        this.ai = ai;
    }

    public RecommendResponse recommend(String query, String conversationId, UUID userId, Consumer<Step> progress) {
        long started = System.currentTimeMillis();
        List<Map<String, Object>> trace = new ArrayList<>();
        List<String> notices = new ArrayList<>();
        Tracker t = new Tracker(progress, trace);

        // 1. understand
        t.start("understand", "Understanding your request");
        IntentExtractor.Result extraction = extractor.extract(query);
        ShoppingIntent intent = extraction.intent();
        UserRepository.Preferences prefs = userId == null ? null : users.findPreferences(userId);
        if (prefs != null && intent.budgetMax() == null && prefs.budgetMax() != null && intent.category() != null) {
            intent = intent.withBudget(prefs.budgetMin(), prefs.budgetMax());
            notices.add("Used your saved budget of up to $" + SpecScorer.plain(prefs.budgetMax()) + ".");
        }
        t.done(Map.of("source", extraction.source(), "category", String.valueOf(intent.category())));

        if (intent.category() == null) {
            RecommendResponse response = new RecommendResponse(intent.interpretedRequirement(), intent.budgetMax(), List.of(),
                    intent.clarifyingQuestion(), null, interpretation(intent, extraction.source()), notices, null,
                    "LLM".equals(extraction.source()));
            UUID id = record(query, conversationId, userId, intent, extraction, null, trace, List.of(), response, started);
            return withAudit(response, id);
        }

        // 2. retrieve
        Constraints constraints = new Constraints(intent.category(), intent.budgetMin(), intent.budgetMax(), intent.minRamGb(),
                intent.minStorageGb(), Boolean.TRUE.equals(intent.needsDedicatedGpu()), intent.preferredOs());
        long inScope = candidates.countInScope(constraints);
        t.start("search", "Searching " + inScope + " in-stock " + categoryLabel(intent.category())
                + (intent.budgetMax() != null ? " under $" + SpecScorer.plain(intent.budgetMax()) : ""));
        float[] queryVector = queryVector(query, notices);
        List<CandidateRepository.Candidate> found = candidates.search(constraints, query + " " + String.join(" ", intent.useCases()),
                queryVector, CANDIDATES);
        if (found.size() < MAX_RECOMMENDATIONS && hasSpecConstraints(constraints)) {
            List<CandidateRepository.Candidate> relaxed = candidates.search(constraints.relaxSpecs(), query, queryVector, CANDIDATES);
            if (relaxed.size() > found.size()) {
                notices.add("Few products met every spec you listed, so I also included close matches.");
                found = relaxed;
            }
        }
        if (found.isEmpty() && intent.budgetMax() != null) {
            BigDecimal stretched = intent.budgetMax().multiply(BigDecimal.valueOf(1.15)).setScale(0, RoundingMode.HALF_UP);
            found = candidates.search(new Constraints(intent.category(), null, stretched, null, null, false, null), query, queryVector, CANDIDATES);
            if (!found.isEmpty()) notices.add("Nothing in stock fit within $" + SpecScorer.plain(intent.budgetMax())
                    + ", so these go up to $" + stretched.toPlainString() + ".");
        }
        t.done(Map.of("candidates", found.size(), "hybrid", queryVector != null));

        if (found.isEmpty()) {
            final String category = categoryLabel(intent.category());
            String question = candidates.cheapestInStock(intent.category())
                    .map(p -> "The lowest-priced in-stock option in " + category + " is the " + p.name()
                            + " at $" + SpecScorer.plain(p.price()) + ". Would you like to see options in that range?")
                    .orElse("Nothing in " + category + " is in stock right now. Would you like to try a different category?");
            RecommendResponse response = new RecommendResponse(intent.interpretedRequirement(), intent.budgetMax(), List.of(), question,
                    null, interpretation(intent, extraction.source()), notices, null, "LLM".equals(extraction.source()));
            UUID id = record(query, conversationId, userId, intent, extraction, null, trace, List.of(), response, started);
            return withAudit(response, id);
        }

        // 3. score
        t.start("score", "Comparing " + found.size() + " candidates on " + criteriaLabel(intent));
        List<String> preferredBrands = prefs == null ? List.of() : prefs.preferredBrands();
        final ShoppingIntent scoredIntent = intent;
        List<SpecScorer.Scored> scored = found.stream()
                .map(c -> scorer.score(c.product(), scoredIntent, preferredBrands))
                .sorted(Comparator.comparingInt(SpecScorer.Scored::score).reversed()
                        .thenComparing(s -> s.product().rating(), Comparator.reverseOrder()))
                .toList();
        List<SpecScorer.Scored> picks = scored.stream().limit(MAX_RECOMMENDATIONS).toList();
        t.done(Map.of("top", picks.stream().map(p -> p.product().id() + ":" + p.score()).toList()));

        // 4. explain
        t.start("explain", "Explaining the picks");
        ReasonWriter.Written written = writer.write(query, intent, picks);
        t.done(Map.of("model", String.valueOf(written.model()), "rejectedExplanations", written.rejected().size()));

        List<Recommendation> recs = picks.stream().map(s -> new Recommendation(
                s.product().id(),
                s.product().name(),
                s.reasonParts().isEmpty() ? s.product().brand() + " " + s.product().categoryName() : String.join(", ", s.reasonParts()),
                s.product().availability(),
                written.explanations().get(s.product().id()),
                s.product().slug(),
                s.product().brand(),
                s.product().price(),
                s.product().mrp(),
                s.product().currency(),
                s.product().image(),
                s.product().rating(),
                s.score(),
                s.matchedRequirements(),
                s.tradeoffs(),
                s.breakdown())).toList();

        boolean aiAssisted = "LLM".equals(extraction.source()) || written.error() == null && written.model() != null;
        if (!ai.nvidiaConfigured()) notices.add("AI model not connected — showing rule-based results.");
        RecommendResponse response = new RecommendResponse(intent.interpretedRequirement(), intent.budgetMax(), recs, null,
                written.summary(), interpretation(intent, extraction.source()), notices, null, aiAssisted);
        UUID id = record(query, conversationId, userId, intent, extraction, written, trace,
                scored.stream().map(s -> s.product().id()).toList(), response, started);
        return withAudit(response, id);
    }

    private float[] queryVector(String query, List<String> notices) {
        if (!ai.nvidiaConfigured()) return null;
        try {
            return embeddings.embed(query);
        } catch (RuntimeException e) {
            log.warn("Query embedding failed, keyword retrieval only: {}", e.getMessage());
            return null;
        }
    }

    private UUID record(String query, String conversationId, UUID userId, ShoppingIntent intent, IntentExtractor.Result extraction,
                        ReasonWriter.Written written, List<Map<String, Object>> trace, List<String> candidateIds,
                        RecommendResponse response, long started) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("intent", intent);
        params.put("source", extraction.source());
        params.put("extractionModel", extraction.model());
        List<String> errors = new ArrayList<>();
        if (extraction.error() != null) errors.add("intent: " + extraction.error());
        if (written != null && written.error() != null) errors.add("explain: " + written.error());
        if (written != null && !written.rejected().isEmpty()) {
            params.put("rejectedExplanations", written.rejected());
        }
        Integer pt = sum(extraction.promptTokens(), written == null ? null : written.promptTokens());
        Integer ct = sum(extraction.completionTokens(), written == null ? null : written.completionTokens());
        String model = written != null && written.model() != null ? written.model() : extraction.model();
        return audit.record(new AuditService.Entry(conversationId, userId, "SHOPPING", "PRODUCT_RECOMMENDATION", query, params,
                trace, candidateIds, response, null, model, pt, ct, (int) (System.currentTimeMillis() - started),
                errors.isEmpty() ? null : String.join(" | ", errors)));
    }

    private static RecommendResponse withAudit(RecommendResponse r, UUID id) {
        return new RecommendResponse(r.interpretedRequirement(), r.budget(), r.recommendations(), r.clarifyingQuestion(), r.summary(),
                r.interpretation(), r.notices(), id, r.aiAssisted());
    }

    private static Interpretation interpretation(ShoppingIntent i, String source) {
        return new Interpretation(i.category(), i.budgetMin(), i.budgetMax(), i.useCases(), i.minRamGb(), i.minStorageGb(),
                i.needsDedicatedGpu(), i.preferredOs(), i.brands(), source);
    }

    private static boolean hasSpecConstraints(Constraints c) {
        return c.minRamGb() != null || c.minStorageGb() != null || c.dedicatedGpu() || c.os() != null;
    }

    private static String categoryLabel(String slug) {
        return slug.replace('-', ' ');
    }

    private static String criteriaLabel(ShoppingIntent i) {
        if ("laptops".equals(i.category())) {
            List<String> parts = new ArrayList<>(List.of("RAM", "CPU", "storage"));
            if (i.has("ai-ml") || i.has("gaming") || i.has("content-creation")) parts.add("GPU");
            if (i.has("travel") || i.has("student")) parts.add("weight");
            return String.join(", ", parts);
        }
        return "specs, ratings and value";
    }

    private static Integer sum(Integer a, Integer b) {
        if (a == null) return b;
        if (b == null) return a;
        return a + b;
    }

    /** Emits running/done steps and keeps a trace for the audit log. */
    private static final class Tracker {
        private final Consumer<Step> progress;
        private final List<Map<String, Object>> trace;
        private String id;
        private String label;
        private long t0;

        Tracker(Consumer<Step> progress, List<Map<String, Object>> trace) {
            this.progress = progress;
            this.trace = trace;
        }

        void start(String id, String label) {
            this.id = id;
            this.label = label;
            this.t0 = System.currentTimeMillis();
            progress.accept(new Step(id, label, "running", null));
        }

        void done(Map<String, Object> detail) {
            long ms = System.currentTimeMillis() - t0;
            progress.accept(new Step(id, label, "done", ms));
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("step", id);
            entry.put("label", label);
            entry.put("durationMs", ms);
            entry.putAll(detail);
            trace.add(entry);
        }
    }
}
