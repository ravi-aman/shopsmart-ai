package com.shopsmart.ai.shopping;

import java.io.IOException;
import java.util.UUID;

import com.shopsmart.ai.RateLimiter;
import com.shopsmart.ai.shopping.ShoppingDtos.RecommendRequest;
import com.shopsmart.ai.shopping.ShoppingDtos.RecommendResponse;
import com.shopsmart.common.BusinessException;
import com.shopsmart.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** AI Shopping Assistant (Module 1). Works signed out; signed-in shoppers get their preferences applied. */
@RestController
@RequestMapping("/api/ai/shopping")
public class ShoppingController {

    private static final Logger log = LoggerFactory.getLogger(ShoppingController.class);

    private final ShoppingAssistantService assistant;
    private final RateLimiter rateLimiter;

    public ShoppingController(ShoppingAssistantService assistant, RateLimiter rateLimiter) {
        this.assistant = assistant;
        this.rateLimiter = rateLimiter;
    }

    /** Returns the brief's JSON contract in one response. */
    @PostMapping("/recommend")
    public RecommendResponse recommend(@Valid @RequestBody RecommendRequest req, @AuthenticationPrincipal Jwt jwt,
                                       HttpServletRequest http) {
        UUID userId = userId(jwt);
        rateLimiter.check(callerKey(userId, http));
        return assistant.recommend(req.query().trim(), req.conversationId(), userId, step -> {});
    }

    /**
     * Same pipeline as server-sent events: {@code step} events while working, then one {@code result}
     * (or {@code error}) event.
     */
    @PostMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@Valid @RequestBody RecommendRequest req, @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        UUID userId = userId(jwt);
        rateLimiter.check(callerKey(userId, http));
        SseEmitter emitter = new SseEmitter(120_000L);
        Thread.ofVirtual().name("shopping-assistant").start(() -> {
            try {
                RecommendResponse result = assistant.recommend(req.query().trim(), req.conversationId(), userId,
                        step -> send(emitter, "step", step));
                send(emitter, "result", result);
                emitter.complete();
            } catch (BusinessException e) {
                send(emitter, "error", new ErrorEvent(e.code(), e.getMessage()));
                emitter.complete();
            } catch (RuntimeException e) {
                log.error("Shopping assistant failed", e);
                send(emitter, "error", new ErrorEvent("ASSISTANT_FAILED", "The assistant hit a problem. Please try again."));
                emitter.complete();
            }
        });
        return emitter;
    }

    private static void send(SseEmitter emitter, String name, Object data) {
        try {
            emitter.send(SseEmitter.event().name(name).data(data, MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException e) {
            // client went away; the pipeline still finishes and is audited
        }
    }

    private static UUID userId(Jwt jwt) {
        return jwt == null ? null : CurrentUser.from(jwt).id();
    }

    private static String callerKey(UUID userId, HttpServletRequest http) {
        return userId != null ? "u:" + userId : "ip:" + http.getRemoteAddr();
    }

    record ErrorEvent(String code, String message) {
    }
}
