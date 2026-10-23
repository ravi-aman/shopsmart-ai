package com.shopsmart.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class KnowledgeAnswerTest {

    private static final UUID CANCEL_DOC = UUID.randomUUID();
    private static final UUID REFUND_DOC = UUID.randomUUID();

    private static KnowledgeRetriever.Hit hit(UUID doc, String title, String section, String body, int kwRank, double score) {
        return new KnowledgeRetriever.Hit(UUID.randomUUID(), doc, title, section, "2026.1", "2026-01-01", "X",
                title + " v2026.1 › " + section + "\n" + body, kwRank, null, null, score);
    }

    private final List<KnowledgeRetriever.Hit> cancelHits = List.of(
            hit(CANCEL_DOC, "Order Cancellation Policy", "Before Shipment",
                    "You can cancel an order free of charge at any time before it is shipped. Go to Orders, select the item and choose Cancel. The refund starts immediately after cancellation is confirmed.", 1, 0.0224),
            hit(CANCEL_DOC, "Order Cancellation Policy", "Partial Cancellation",
                    "For orders with several items, each item that has not yet shipped can be cancelled separately.", 2, 0.0221),
            hit(CANCEL_DOC, "Order Cancellation Policy", "Cancellation by ShopSmart",
                    "ShopSmart may cancel an order if the item becomes unavailable.", 3, 0.0219),
            hit(CANCEL_DOC, "Order Cancellation Policy", "After Shipment",
                    "Once an order has shipped, it can no longer be cancelled. You can refuse the delivery when the courier arrives, or accept it and request a return within the return window for that category.", 4, 0.0216));

    @Test
    void cancelAfterShipmentPrefersTheAfterShipmentSection() {
        String q = "Can I cancel my order after shipment?";
        var ranked = KnowledgeAnswerService.rerank(q, cancelHits);
        assertThat(ranked.getFirst().section()).isEqualTo("After Shipment");
        var g = KnowledgeAnswerService.extractive(q, ranked, null);
        assertThat(g.answer).startsWith("Once an order has shipped, it can no longer be cancelled.");
    }

    @Test
    void refundTimelineQuotesTheList() {
        var hits = List.of(
                hit(REFUND_DOC, "Refund Policy", "When a Refund Starts",
                        "For returns, the refund is initiated within 48 hours after the item passes the quality check at pickup.", 1, 0.0224),
                hit(REFUND_DOC, "Refund Policy", "Refund Timeline",
                        "After a refund is initiated, the time for money to reach you depends on the payment method:\nShopSmart Wallet: instant.\nUPI: 1 to 3 business days.\nCredit and debit cards: 5 to 7 business days.", 2, 0.0221));
        String q = "What is the refund timeline?";
        var ranked = KnowledgeAnswerService.rerank(q, hits);
        assertThat(ranked.getFirst().section()).isEqualTo("Refund Timeline");
        var g = KnowledgeAnswerService.extractive(q, ranked, null);
        assertThat(g.answer).contains("UPI: 1 to 3 business days");
    }

    @Test
    void unrelatedNumbersAreRejected() {
        assertThat(KnowledgeAnswerService.numbersGrounded("Returns are accepted within 7 days.", "within 7 days of delivery")).isTrue();
        assertThat(KnowledgeAnswerService.numbersGrounded("Returns are accepted within 30 days.", "within 7 days of delivery")).isFalse();
    }

    @Test
    void markdownKeepsHeadingPaths() {
        var sections = DocumentParser.markdown("# T\n\n## A\ntext a\n### B\ntext b\n", "T");
        assertThat(sections).extracting(DocumentParser.Section::title).containsExactly("A", "A › B");
    }

    @Test
    void pdfHeadingDetection() {
        var sections = DocumentParser.headingSections("""
                Laptop Return Policy
                Version 2026.1 - Effective 1 January 2026
                This policy applies to all laptops.
                Opened Products
                Opened laptops can be returned within 7 days of delivery if there is no
                physical damage.
                """, "Laptop Return Policy");
        assertThat(sections).extracting(DocumentParser.Section::title).containsExactly("Overview", "Opened Products");
        assertThat(sections.get(1).text()).contains("if there is no physical damage.");
    }
}
