package com.shopsmart.order;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;
import java.util.Set;

/**
 * Business rules that mirror the approved policy documents (Shipping Policy, Delivery SLA, Return
 * Policy, Cancellation Policy). Each rule carries the document and section it comes from, so the
 * order agent and UI can cite it.
 */
public final class OrderRules {

    private OrderRules() {
    }

    public record PolicyRef(String document, String section) {
    }

    public static final PolicyRef SHIPPING_BASIC = new PolicyRef("Shipping Policy", "Shipping Fees for Basic Members");
    public static final PolicyRef SHIPPING_PRIME = new PolicyRef("Shipping Policy", "Shipping Fees for Prime Members");
    public static final PolicyRef SHIPPING_PREMIUM = new PolicyRef("Shipping Policy", "Shipping Fees for Premium Members");
    public static final PolicyRef SLA_CROSS_REGION = new PolicyRef("Delivery SLA by Region", "Cross-Region Orders");
    public static final PolicyRef CANCEL_BEFORE = new PolicyRef("Order Cancellation Policy", "Before Shipment");
    public static final PolicyRef CANCEL_AFTER = new PolicyRef("Order Cancellation Policy", "After Shipment");
    public static final PolicyRef CANCEL_OFD = new PolicyRef("Order Cancellation Policy", "Out for Delivery");
    public static final PolicyRef RETURN_WINDOWS = new PolicyRef("ShopSmart Return Policy", "Return Windows by Category");
    public static final PolicyRef RETURN_LAPTOP = new PolicyRef("Laptop Return Policy", "Opened Products");

    static final BigDecimal FREE_SHIPPING_THRESHOLD = new BigDecimal("35");
    static final BigDecimal BASIC_SHIPPING_FEE = new BigDecimal("4.99");

    public record Fee(BigDecimal amount, String explanation, PolicyRef source) {
    }

    public static Fee shippingFee(String tier, BigDecimal subtotal) {
        return switch (tier == null ? "BASIC" : tier) {
            case "PREMIUM" -> new Fee(BigDecimal.ZERO, "Free delivery for Premium members", SHIPPING_PREMIUM);
            case "PRIME" -> new Fee(BigDecimal.ZERO, "Free Standard delivery for Prime members, no minimum", SHIPPING_PRIME);
            default -> subtotal.compareTo(FREE_SHIPPING_THRESHOLD) >= 0
                    ? new Fee(BigDecimal.ZERO, "Free Standard delivery on orders of $35 or more", SHIPPING_BASIC)
                    : new Fee(BASIC_SHIPPING_FEE, "$4.99 delivery on orders under $35 (Basic)", SHIPPING_BASIC);
        };
    }

    /** Standard delivery days from the Delivery SLA (metro estimate) plus 2 days when shipping cross-region. */
    public static int deliveryDays(String customerRegion, String warehouseRegion) {
        int base = "IN-EAST".equals(customerRegion) ? 3 : 2;
        return customerRegion != null && customerRegion.equals(warehouseRegion) ? base : base + 2;
    }

    public static LocalDate promisedDate(LocalDate from, String customerRegion, String warehouseRegion) {
        return from.plusDays(deliveryDays(customerRegion, warehouseRegion));
    }

    /** Statuses in which the shopper may still cancel (before shipment). */
    public static final Set<String> CANCELLABLE = Set.of("PLACED", "PACKED");

    public static PolicyRef cancelPolicyFor(String status) {
        if (CANCELLABLE.contains(status)) return CANCEL_BEFORE;
        if ("OUT_FOR_DELIVERY".equals(status)) return CANCEL_OFD;
        return CANCEL_AFTER;
    }

    /** Return window in days by top-level category slug (laptops handled separately). */
    private static final Map<String, Integer> RETURN_DAYS = Map.of(
            "electronics", 7, "fashion", 30, "home-appliances", 10, "books", 10, "healthcare", 7, "groceries", 0);

    public record ReturnWindow(int days, PolicyRef source) {
    }

    public static ReturnWindow returnWindow(String categoryPath) {
        if (categoryPath.endsWith("/laptops")) return new ReturnWindow(7, RETURN_LAPTOP);
        String top = categoryPath.contains("/") ? categoryPath.substring(0, categoryPath.indexOf('/')) : categoryPath;
        return new ReturnWindow(RETURN_DAYS.getOrDefault(top, 7), RETURN_WINDOWS);
    }
}
