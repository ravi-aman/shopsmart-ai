package com.shopsmart.ai.shopping;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.shopsmart.catalog.CatalogDtos.Availability;
import com.shopsmart.catalog.CatalogDtos.ProductSummary;
import org.junit.jupiter.api.Test;

class ShoppingPipelineTest {

    private final RuleBasedIntentParser parser = new RuleBasedIntentParser();
    private final SpecScorer scorer = new SpecScorer();

    @Test
    void parsesTheBriefExample() {
        ShoppingIntent i = parser.parse("Suggest a laptop under $1000 for Java development and AI projects.", Set.of("Dell"));
        assertThat(i.category()).isEqualTo("laptops");
        assertThat(i.budgetMax()).isEqualByComparingTo("1000");
        assertThat(i.useCases()).containsExactly("software-development", "ai-ml");
        assertThat(i.clarifyingQuestion()).isNull();
    }

    @Test
    void asksWhenProductTypeIsUnknown() {
        ShoppingIntent i = parser.parse("something nice for my mom", Set.of());
        assertThat(i.category()).isNull();
        assertThat(i.clarifyingQuestion()).isNotBlank();
    }

    @Test
    void headphonesAreNotPhonesAndLaterBudgetWins() {
        assertThat(parser.parse("noise cancelling headphones", Set.of()).category()).isEqualTo("audio");
        ShoppingIntent i = parser.parse("cheap laptop under $300. Show options up to $500", Set.of());
        assertThat(i.budgetMax()).isEqualByComparingTo("500");
    }

    @Test
    void parsesRamAndKiloBudgets() {
        ShoppingIntent i = parser.parse("gaming laptop with 32GB RAM and RTX under 1.2k", Set.of());
        assertThat(i.minRamGb()).isEqualTo(32);
        assertThat(i.needsDedicatedGpu()).isTrue();
        assertThat(i.budgetMax()).isEqualByComparingTo("1200");
    }

    @Test
    void scoresLap101WithTheBriefsReason() {
        ShoppingIntent intent = parser.parse("laptop under $1000 for Java development and AI projects", Set.of());
        var scored = scorer.score(lap101(), intent, List.of());
        assertThat(String.join(", ", scored.reasonParts())).isEqualTo("16GB RAM, Intel i7 processor, SSD storage");
        assertThat(scored.tradeoffs()).anyMatch(t -> t.contains("Integrated graphics"));
        assertThat(scored.score()).isBetween(1, 100);
        double sum = scored.breakdown().stream().mapToDouble(SpecScorer.Criterion::points).sum();
        double max = scored.breakdown().stream().mapToDouble(SpecScorer.Criterion::max).sum();
        assertThat(scored.score()).isEqualTo((int) Math.round(sum / max * 100));
    }

    @Test
    void rejectsExplanationsWithInventedNumbers() {
        ShoppingIntent intent = parser.parse("laptop under $1000 for Java", Set.of());
        var scored = scorer.score(lap101(), intent, List.of());
        Set<String> facts = ReasonWriter.factNumbers(scored, intent, "laptop under $1000 for Java");
        assertThat(ReasonWriter.grounded("16GB RAM and an i7 keep builds fast, at $899 within your $1,000 budget.", facts)).isTrue();
        assertThat(ReasonWriter.grounded("Benchmarks show 35% faster builds with 12 hours of battery.", facts)).isFalse();
    }

    @Test
    void shortensCpuNames() {
        assertThat(SpecScorer.cpuShort("Intel Core i7-1355U (10 cores)")).isEqualTo("Intel i7 processor");
        assertThat(SpecScorer.cpuShort("AMD Ryzen 7 7730U (8 cores)")).isEqualTo("AMD Ryzen 7 processor");
        assertThat(SpecScorer.cpuShort("Apple M3 (8-core CPU)")).isEqualTo("Apple M3 chip");
        assertThat(SpecScorer.cpuShort("Intel Core Ultra 7 155H (16 cores)")).isEqualTo("Intel Core Ultra 7 processor");
    }

    @Test
    void keywordQueryDropsFillerWords() {
        assertThat(CandidateRepository.keywordQuery("Suggest a laptop under $1000 for Java development and AI projects"))
                .isEqualTo("laptop or java or development or ai");
    }

    private static ProductSummary lap101() {
        Map<String, Object> specs = Map.of(
                "type", "Laptop", "cpu", "Intel Core i7-1355U (10 cores)", "ramGb", 16, "storageGb", 512,
                "storageType", "SSD", "gpu", "Intel Iris Xe", "displayInches", 15.6, "weightKg", 1.65,
                "batteryHours", 8, "os", "Windows 11 Home");
        return new ProductSummary("LAP101", "dell-inspiron-15-lap101", "Dell Inspiron 15", "Dell", "laptops", "Laptops",
                new BigDecimal("899.00"), new BigDecimal("1049.00"), "USD", new BigDecimal("4.3"), 1549, null, specs,
                Availability.IN_STOCK, 125);
    }
}
