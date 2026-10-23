package com.shopsmart.ops;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.shopsmart.ai.AuditService;
import com.shopsmart.ai.config.AiProperties;
import com.shopsmart.common.Json;
import com.shopsmart.security.CurrentUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Service;

/**
 * Ops agent for the back office: reads forecasts, fulfilment issues and KPIs through tools, explains
 * them, and proposes transfers or promotions that a human approves. Numbers come from the
 * deterministic services; the model (when connected) only chooses tools and writes the summary.
 */
@Service
public class OpsAgentService {

    private static final Logger log = LoggerFactory.getLogger(OpsAgentService.class);
    private static final Pattern NUMBER = Pattern.compile("\\d+(?:\\.\\d+)?");

    private static final String SYSTEM = """
            You are ShopSmart's operations analyst. Use the tools to get facts; never invent numbers.
            Explain the most urgent problems first and say which proposed actions a human should approve.
            Keep it to 3-5 short sentences.
            """;

    public record Action(String type, String productId, String productName, String fromWarehouse, String toWarehouse,
                         Integer quantity, BigDecimal discountPercent, String rationale) {
    }

    public record OpsAnswer(String answer, List<Action> actions, Map<String, Object> data, List<Map<String, Object>> toolCalls,
                            boolean aiAssisted, UUID auditId) {
    }

    private final ForecastService forecast;
    private final OpsService ops;
    private final ChatClient agent;
    private final AiProperties ai;
    private final AuditService audit;
    private final Json json;

    public OpsAgentService(ForecastService forecast, OpsService ops, ChatClient agent, AiProperties ai, AuditService audit, Json json) {
        this.forecast = forecast;
        this.ops = ops;
        this.agent = agent;
        this.ai = ai;
        this.audit = audit;
        this.json = json;
    }

    /** Request-scoped tools; they record what they return so the UI can show tables and action cards. */
    public class Tools {
        final List<Map<String, Object>> calls = new ArrayList<>();
        final List<Action> actions = new ArrayList<>();
        final Map<String, Object> data = new LinkedHashMap<>();

        @Tool(description = "List products at risk of stocking out per fulfilment centre, with days of cover and a recommended transfer or reorder")
        public String getStockRisks(@ToolParam(description = "Maximum rows, e.g. 8") int limit) {
            var all = forecast.risks();
            // show the worst stock-outs and the worst of the positions that are about to run out
            var rows = java.util.stream.Stream.concat(
                    all.stream().filter(r -> r.position().risk() == ForecastService.Risk.OUT_OF_STOCK).limit(Math.max(1, limit / 2)),
                    all.stream().filter(r -> r.position().risk() != ForecastService.Risk.OUT_OF_STOCK).limit(Math.max(1, limit - limit / 2)))
                    .toList();
            data.put("risks", rows);
            data.put("riskCounts", all.stream().collect(java.util.stream.Collectors.groupingBy(r -> r.position().risk().name(), java.util.stream.Collectors.counting())));
            for (var r : rows) {
                var rec = r.recommendation();
                if ("TRANSFER".equals(rec.type()) && actions.stream().noneMatch(a -> rec.productId().equals(a.productId()) && "TRANSFER".equals(a.type()))) {
                    actions.add(new Action("TRANSFER", rec.productId(), rec.productName(), rec.fromWarehouse(), rec.toWarehouse(), rec.quantity(), null, rec.rationale()));
                }
            }
            log("getStockRisks", Map.of("limit", limit), rows.size() + " at-risk positions");
            return json.write(rows);
        }

        @Tool(description = "List orders with fulfilment problems: delayed in transit, not dispatched, or past the promised date")
        public String getFulfillmentIssues() {
            var issues = ops.issues();
            data.put("issues", issues);
            log("getFulfillmentIssues", Map.of(), issues.size() + " issues");
            return json.write(issues);
        }

        @Tool(description = "Find overstocked, slow-selling products and suggest a discount to clear them")
        public String suggestPromotions(@ToolParam(description = "Maximum products, e.g. 5") int limit) {
            var rows = forecast.overstock(Math.max(1, Math.min(limit, 10)));
            data.put("overstock", rows);
            for (var r : rows) {
                Object cover = r.get("daysOfCover");
                BigDecimal pct = cover == null || ((Number) cover).doubleValue() > 120 ? BigDecimal.valueOf(15) : BigDecimal.TEN;
                actions.add(new Action("PROMOTION", (String) r.get("productId"), (String) r.get("productName"), null, null, null, pct,
                        r.get("available") + " units in stock, " + (cover == null ? "no sales in 14 days" : cover + " days of cover")
                                + " — a " + pct + "% discount for 14 days should clear excess stock."));
            }
            log("suggestPromotions", Map.of("limit", limit), rows.size() + " candidates");
            return json.write(rows);
        }

        @Tool(description = "Today's operating KPIs: orders, revenue, open orders, delayed shipments, AI answer volume and quality")
        public String getKpis() {
            var k = new LinkedHashMap<>(ops.kpis());
            k.remove("ordersByDay");
            data.put("kpis", k);
            log("getKpis", Map.of(), "ok");
            return json.write(k);
        }

        private void log(String tool, Map<String, Object> args, String result) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("tool", tool);
            m.put("args", args);
            m.put("result", result);
            calls.add(m);
        }
    }

    public OpsAnswer ask(String question, CurrentUser user) {
        long started = System.currentTimeMillis();
        Tools tools = new Tools();
        String text = null;
        String error = null;
        boolean aiAssisted = false;
        if (ai.nvidiaConfigured()) {
            try {
                text = agent.prompt().system(SYSTEM).user(u -> u.text("<<<{q}>>>").param("q", question)).tools(tools).call().content();
                aiAssisted = true;
            } catch (RuntimeException e) {
                log.warn("Ops agent via {} failed, using fixed plan: {}", ai.agentModel(), e.getMessage());
                error = e.getClass().getSimpleName() + ": " + e.getMessage();
            }
        } else {
            error = "NVIDIA_API_KEY not configured";
        }
        plan(question, tools);
        String template = summarize(tools);
        if (text == null || text.isBlank() || !grounded(text, tools)) {
            if (text != null && !text.isBlank()) error = "LLM summary cited numbers not returned by tools; used template";
            text = template;
            aiAssisted = false;
        }
        OpsAnswer answer = new OpsAnswer(text.trim(), tools.actions, tools.data, tools.calls, aiAssisted, null);
        UUID id = audit.record(new AuditService.Entry(null, user.id(), "OPS", "OPS_QUESTION", question,
                Map.of("mode", aiAssisted ? "LLM_TOOLS" : "FIXED_PLAN"), tools.calls, List.of(), Map.of("answer", answer.answer(), "actions", answer.actions()),
                null, aiAssisted ? ai.agentModel() : null, null, null, (int) (System.currentTimeMillis() - started), error));
        return new OpsAnswer(answer.answer(), answer.actions(), answer.data(), answer.toolCalls(), answer.aiAssisted(), id);
    }

    /** Fixed plan: pick tools from the question's topic; backfills anything the model didn't fetch. */
    private static void plan(String question, Tools tools) {
        String q = question.toLowerCase(Locale.ROOT);
        boolean stock = q.matches(".*(stock|inventory|run out|stockout|stock-out|reorder|transfer|warehouse).*");
        boolean delays = q.matches(".*(delay|late|fulfil|fulfill|shipment|dispatch|stuck|issue).*");
        boolean promo = q.matches(".*(promo|discount|overstock|clear|sale|slow).*");
        boolean all = !stock && !delays && !promo;
        boolean called = !tools.calls.isEmpty();
        if ((stock || all) && tools.data.get("risks") == null) tools.getStockRisks(8);
        if ((delays || all) && tools.data.get("issues") == null) tools.getFulfillmentIssues();
        if ((promo || all) && tools.data.get("overstock") == null) tools.suggestPromotions(4);
        if (all && !called && tools.data.get("kpis") == null) tools.getKpis();
    }

    @SuppressWarnings("unchecked")
    private static String summarize(Tools tools) {
        List<String> parts = new ArrayList<>();
        var risks = (List<ForecastService.RiskRow>) tools.data.get("risks");
        if (risks != null) {
            if (risks.isEmpty()) {
                parts.add("No product is at risk of stocking out in the next two weeks.");
            } else {
                var counts = (Map<String, Long>) tools.data.getOrDefault("riskCounts", Map.of());
                long out = counts.getOrDefault("OUT_OF_STOCK", 0L);
                long critical = counts.getOrDefault("CRITICAL", 0L);
                long low = counts.getOrDefault("LOW", 0L);
                var top = risks.stream().filter(r -> r.position().risk() != ForecastService.Risk.OUT_OF_STOCK).findFirst().orElse(risks.getFirst());
                parts.add((out + critical + low) + " stock positions need attention: " + critical + " will run out within the "
                        + ForecastService.LEAD_TIME_DAYS + "-day lead time, " + low + " within two weeks, and " + out + " are already out of stock.");
                parts.add("Most urgent: " + top.position().productName() + " in " + top.position().city() + " — " + top.position().available()
                        + " units left, selling " + top.position().dailySales() + "/day"
                        + (top.position().daysOfCover() == null ? "" : " (" + top.position().daysOfCover() + " days of cover)") + ". "
                        + top.recommendation().rationale());
            }
        }
        var issues = (List<Map<String, Object>>) tools.data.get("issues");
        if (issues != null) {
            parts.add(issues.isEmpty() ? "No delayed or stuck orders right now."
                    : issues.size() + " order" + (issues.size() == 1 ? " has" : "s have") + " fulfilment issues, e.g. " + issues.getFirst().get("orderId")
                      + " (" + String.valueOf(issues.getFirst().get("issue")).toLowerCase(Locale.ROOT).replace('_', ' ') + ").");
        }
        var overstock = (List<Map<String, Object>>) tools.data.get("overstock");
        if (overstock != null && !overstock.isEmpty()) {
            parts.add(overstock.size() + " slow sellers could be promoted, starting with " + overstock.getFirst().get("productName") + " ("
                    + overstock.getFirst().get("available") + " units).");
        }
        long transfers = tools.actions.stream().filter(a -> a.type().equals("TRANSFER")).count();
        long promos = tools.actions.stream().filter(a -> a.type().equals("PROMOTION")).count();
        if (transfers + promos > 0) {
            parts.add("Review and approve " + (transfers > 0 ? transfers + " transfer" + (transfers > 1 ? "s" : "") : "")
                    + (transfers > 0 && promos > 0 ? " and " : "") + (promos > 0 ? promos + " promotion draft" + (promos > 1 ? "s" : "") : "") + " below.");
        }
        return String.join(" ", parts);
    }

    private boolean grounded(String text, Tools tools) {
        String facts = json.write(tools.data) + json.write(tools.actions) + ForecastService.LEAD_TIME_DAYS;
        Matcher m = NUMBER.matcher(text.replace(",", ""));
        while (m.find()) {
            if (!facts.contains(m.group())) return false;
        }
        return true;
    }
}
