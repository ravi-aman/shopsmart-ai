package com.shopsmart.ai;

import java.io.IOException;
import java.util.Map;

import com.shopsmart.ai.shopping.ShoppingAssistantService;
import com.shopsmart.common.BusinessException;
import com.shopsmart.knowledge.KnowledgeAnswerService;
import com.shopsmart.order.agent.OrderAgentService;
import com.shopsmart.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * One entry point for the assistant drawer: routes each message to the shopping or knowledge agent
 * and streams progress. Events: {@code route}, {@code step}…, then {@code result} or {@code error}.
 */
@RestController
public class AssistantController {

    private static final Logger log = LoggerFactory.getLogger(AssistantController.class);

    private final AssistantRouter router;
    private final ShoppingAssistantService shopping;
    private final KnowledgeAnswerService knowledge;
    private final OrderAgentService orderAgent;
    private final RateLimiter rateLimiter;

    public AssistantController(AssistantRouter router, ShoppingAssistantService shopping, KnowledgeAnswerService knowledge,
                               OrderAgentService orderAgent, RateLimiter rateLimiter) {
        this.router = router;
        this.orderAgent = orderAgent;
        this.shopping = shopping;
        this.knowledge = knowledge;
        this.rateLimiter = rateLimiter;
    }

    public record MessageRequest(@NotBlank @Size(max = 600) String message, @Size(max = 20) String productId,
                                 @Size(max = 64) String conversationId) {
    }

    @PostMapping(path = "/api/ai/assistant/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@Valid @RequestBody MessageRequest req, @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        CurrentUser user = jwt == null ? null : CurrentUser.from(jwt);
        rateLimiter.check(user != null ? "u:" + user.id() : "ip:" + http.getRemoteAddr());
        String message = req.message().trim();
        boolean productContext = req.productId() != null && !req.productId().isBlank();
        AssistantRouter.Agent agent = router.route(message, productContext);

        SseEmitter emitter = new SseEmitter(120_000L);
        Thread.ofVirtual().name("assistant-" + agent.name().toLowerCase()).start(() -> {
            try {
                send(emitter, "route", Map.of("agent", agent.name()));
                Object result = switch (agent) {
                    case SHOPPING -> shopping.recommend(message, req.conversationId(), user == null ? null : user.id(),
                            step -> send(emitter, "step", step));
                    case KNOWLEDGE -> knowledge.answer(message, req.productId(), req.conversationId(), user,
                            step -> send(emitter, "step", step));
                    case ORDER -> orderAgent.answer(message, user, req.conversationId(), step -> send(emitter, "step", step));
                };
                send(emitter, "result", Map.of("agent", agent.name(), "data", result));
            } catch (BusinessException e) {
                send(emitter, "error", Map.of("code", e.code(), "message", e.getMessage()));
            } catch (RuntimeException e) {
                log.error("Assistant failed", e);
                send(emitter, "error", Map.of("code", "ASSISTANT_FAILED", "message", "The assistant hit a problem. Please try again."));
            } finally {
                emitter.complete();
            }
        });
        return emitter;
    }

    private static void send(SseEmitter emitter, String name, Object data) {
        try {
            emitter.send(SseEmitter.event().name(name).data(data, MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException e) {
            // client disconnected; work still completes and is audited
        }
    }
}
