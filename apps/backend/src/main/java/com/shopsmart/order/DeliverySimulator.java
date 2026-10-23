package com.shopsmart.order;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Mock carrier: every tick, orders whose last event is older than the step interval move one status
 * forward (some get a hub delay). Payment and real carriers are out of scope for the brief.
 */
@Component
public class DeliverySimulator {

    private static final Logger log = LoggerFactory.getLogger(DeliverySimulator.class);

    private final OrderService orders;
    private final boolean enabled;
    private final int stepSeconds;

    public DeliverySimulator(OrderService orders,
                             @Value("${SIMULATOR_ENABLED:true}") boolean enabled,
                             @Value("${SIMULATOR_STEP_SECONDS:180}") int stepSeconds) {
        this.orders = orders;
        this.enabled = enabled;
        this.stepSeconds = stepSeconds;
    }

    @Scheduled(fixedDelayString = "${SIMULATOR_TICK_MS:30000}", initialDelay = 30_000)
    public void tick() {
        if (!enabled) return;
        for (String id : orders.ordersDueForAdvance(stepSeconds)) {
            try {
                orders.advance(id).ifPresent(next -> log.debug("Simulator moved {} to {}", id, next));
            } catch (RuntimeException e) {
                log.warn("Simulator could not advance {}: {}", id, e.getMessage());
            }
        }
    }
}
