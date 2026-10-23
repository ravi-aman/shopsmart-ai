package com.shopsmart.order;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class OrderDtos {

    private OrderDtos() {
    }

    public record Address(
            @NotBlank @Size(max = 120) String name,
            @NotBlank @Size(max = 200) String line1,
            @NotBlank @Size(max = 80) String city,
            @NotBlank @Pattern(regexp = "\\d{6}", message = "must be a 6-digit PIN code") String pincode,
            @NotBlank @Pattern(regexp = "IN-(WEST|NORTH|SOUTH|EAST)", message = "unknown region") String region,
            @NotBlank @Pattern(regexp = "[0-9+ -]{8,15}", message = "must be a valid phone number") String phone) {
    }

    public record CheckoutRequest(@NotNull @Valid Address address) {
    }

    public record QuoteRequest(@NotBlank @Pattern(regexp = "IN-(WEST|NORTH|SOUTH|EAST)") String region) {
    }

    public record Policy(String document, String section, String version) {
    }

    public record Quote(
            BigDecimal subtotal,
            BigDecimal shippingFee,
            BigDecimal total,
            String shippingExplanation,
            Policy shippingPolicy,
            String warehouseId,
            String warehouseCity,
            LocalDate promisedDate,
            boolean crossRegion,
            int itemCount) {
    }

    public record OrderItem(String productId, String name, String slug, String image, String brand, String category, int quantity,
                            BigDecimal unitPrice, ReturnInfo returnInfo) {
    }

    /** Whether this line can be returned now, until when, and under which policy. */
    public record ReturnInfo(boolean eligible, LocalDate deadline, String reason, Policy policy, String requestStatus) {
    }

    public record Event(String status, String location, String note, OffsetDateTime at) {
    }

    public record Shipment(String id, String carrier, String trackingNo, LocalDate eta, boolean delayed, List<Event> events) {
    }

    public record CancelInfo(boolean allowed, String reason, Policy policy) {
    }

    public record OrderSummary(String id, String status, BigDecimal total, String currency, int itemCount, String firstItemName,
                               String firstItemImage, LocalDate promisedDate, OffsetDateTime createdAt) {
    }

    public record OrderDetail(
            String id,
            String status,
            BigDecimal subtotal,
            BigDecimal shippingFee,
            BigDecimal total,
            String currency,
            Address address,
            String warehouseId,
            String warehouseCity,
            LocalDate promisedDate,
            OffsetDateTime createdAt,
            OffsetDateTime deliveredAt,
            List<OrderItem> items,
            Shipment shipment,
            CancelInfo cancel) {
    }

    public record ReturnRequest(@NotBlank @Size(max = 20) String productId, @NotBlank @Size(min = 3, max = 500) String reason) {
    }
}
