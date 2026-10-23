package com.shopsmart.ai.shopping;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

/**
 * Deterministic intent parser. Used when the NVIDIA model is unavailable, and to backfill hard facts
 * (budget, RAM) the model missed. Keeps the assistant working offline and makes demos repeatable.
 */
@Component
public class RuleBasedIntentParser {

    private static final Pattern BUDGET_MAX = Pattern.compile(
            "(?:under|below|less than|up ?to|upto|within|max(?:imum)?|budget(?: of| is)?|around|<)\\s*(?:usd|\\$)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k)?\\b");
    private static final Pattern BUDGET_RANGE = Pattern.compile(
            "(?:between|from)?\\s*\\$\\s*(\\d[\\d,]*)\\s*(?:-|to|and)\\s*\\$?\\s*(\\d[\\d,]*)");
    private static final Pattern BARE_DOLLARS = Pattern.compile("\\$\\s*(\\d[\\d,]*)\\s*(k)?\\b");
    private static final Pattern RAM = Pattern.compile("(\\d{1,3})\\s*gb\\s*(?:of\\s*)?ram");
    private static final Pattern STORAGE = Pattern.compile("(\\d(?:\\.\\d)?|\\d{3,4})\\s*(tb|gb)\\s*(?:ssd|storage)");

    /** Keyword → category slug. Order matters: more specific first. */
    private static final Map<String, String> CATEGORY_KEYWORDS = new LinkedHashMap<>();
    /** Keyword → use-case tag. */
    private static final Map<String, String> USE_CASE_KEYWORDS = new LinkedHashMap<>();

    static {
        CATEGORY_KEYWORDS.put("washing machine", "large-appliances");
        CATEGORY_KEYWORDS.put("refrigerator", "large-appliances");
        CATEGORY_KEYWORDS.put("fridge", "large-appliances");
        CATEGORY_KEYWORDS.put("air conditioner", "large-appliances");
        CATEGORY_KEYWORDS.put("air fryer", "large-appliances");
        CATEGORY_KEYWORDS.put("microwave", "large-appliances");
        CATEGORY_KEYWORDS.put("vacuum", "large-appliances");
        CATEGORY_KEYWORDS.put("water purifier", "large-appliances");
        CATEGORY_KEYWORDS.put("blood pressure", "health-devices");
        CATEGORY_KEYWORDS.put("bp monitor", "health-devices");
        CATEGORY_KEYWORDS.put("thermometer", "health-devices");
        CATEGORY_KEYWORDS.put("oximeter", "health-devices");
        CATEGORY_KEYWORDS.put("glucometer", "health-devices");
        CATEGORY_KEYWORDS.put("laptop", "laptops");
        CATEGORY_KEYWORDS.put("notebook", "laptops");
        CATEGORY_KEYWORDS.put("macbook", "laptops");
        CATEGORY_KEYWORDS.put("chromebook", "laptops");
        // audio before "phone" so "headphones" is not read as a phone
        CATEGORY_KEYWORDS.put("headphone", "audio");
        CATEGORY_KEYWORDS.put("earbud", "audio");
        CATEGORY_KEYWORDS.put("earphone", "audio");
        CATEGORY_KEYWORDS.put("speaker", "audio");
        CATEGORY_KEYWORDS.put("smartphone", "smartphones");
        CATEGORY_KEYWORDS.put("iphone", "smartphones");
        CATEGORY_KEYWORDS.put("phone", "smartphones");
        CATEGORY_KEYWORDS.put("mobile", "smartphones");
        CATEGORY_KEYWORDS.put("tablet", "tablets");
        CATEGORY_KEYWORDS.put("ipad", "tablets");
        CATEGORY_KEYWORDS.put("watch", "watches");
        CATEGORY_KEYWORDS.put("sunglass", "eyewear");
        CATEGORY_KEYWORDS.put("shoe", "footwear");
        CATEGORY_KEYWORDS.put("sneaker", "footwear");
        CATEGORY_KEYWORDS.put("perfume", "fragrances");
        CATEGORY_KEYWORDS.put("fragrance", "fragrances");
        CATEGORY_KEYWORDS.put("book", "books");

        USE_CASE_KEYWORDS.put("java", "software-development");
        USE_CASE_KEYWORDS.put("python", "software-development");
        USE_CASE_KEYWORDS.put("coding", "software-development");
        USE_CASE_KEYWORDS.put("programming", "software-development");
        USE_CASE_KEYWORDS.put("developer", "software-development");
        USE_CASE_KEYWORDS.put("development", "software-development");
        USE_CASE_KEYWORDS.put("software", "software-development");
        USE_CASE_KEYWORDS.put("machine learning", "ai-ml");
        USE_CASE_KEYWORDS.put("deep learning", "ai-ml");
        USE_CASE_KEYWORDS.put("data science", "ai-ml");
        USE_CASE_KEYWORDS.put(" ai ", "ai-ml");
        USE_CASE_KEYWORDS.put(" ml ", "ai-ml");
        USE_CASE_KEYWORDS.put("llm", "ai-ml");
        USE_CASE_KEYWORDS.put("gaming", "gaming");
        USE_CASE_KEYWORDS.put("games", "gaming");
        USE_CASE_KEYWORDS.put("office", "office");
        USE_CASE_KEYWORDS.put("excel", "office");
        USE_CASE_KEYWORDS.put("student", "student");
        USE_CASE_KEYWORDS.put("college", "student");
        USE_CASE_KEYWORDS.put("school", "student");
        USE_CASE_KEYWORDS.put("travel", "travel");
        USE_CASE_KEYWORDS.put("portable", "travel");
        USE_CASE_KEYWORDS.put("lightweight", "travel");
        USE_CASE_KEYWORDS.put("video editing", "content-creation");
        USE_CASE_KEYWORDS.put("photo editing", "content-creation");
        USE_CASE_KEYWORDS.put("design", "content-creation");
        USE_CASE_KEYWORDS.put("camera", "photography");
        USE_CASE_KEYWORDS.put("photos", "photography");
        USE_CASE_KEYWORDS.put("music", "music");
        USE_CASE_KEYWORDS.put("running", "fitness");
        USE_CASE_KEYWORDS.put("gym", "fitness");
        USE_CASE_KEYWORDS.put("cooking", "cooking");
        USE_CASE_KEYWORDS.put("reading", "reading");
    }

    public ShoppingIntent parse(String query, Set<String> knownBrands) {
        String q = " " + query.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9$.,\\- ]", " ").replaceAll("\\s+", " ") + " ";

        String category = null;
        for (var e : CATEGORY_KEYWORDS.entrySet()) {
            if (q.contains(e.getKey())) {
                category = e.getValue();
                break;
            }
        }

        Set<String> useCases = new LinkedHashSet<>();
        USE_CASE_KEYWORDS.forEach((k, v) -> {
            if (q.contains(k)) useCases.add(v);
        });

        BigDecimal min = null;
        BigDecimal max = null;
        Matcher range = BUDGET_RANGE.matcher(q);
        Matcher upper = BUDGET_MAX.matcher(q);
        Matcher bare = BARE_DOLLARS.matcher(q);
        // The last stated budget wins, so a follow-up like "... show options up to $500" overrides "under $300".
        if (range.find()) {
            min = money(range.group(1), null);
            max = money(range.group(2), null);
        }
        while (upper.find()) {
            max = money(upper.group(1), upper.group(2));
            min = null;
        }
        if (max == null) {
            while (bare.find()) max = money(bare.group(1), bare.group(2));
        }

        Integer ram = null;
        Matcher ramM = RAM.matcher(q);
        if (ramM.find()) ram = Integer.parseInt(ramM.group(1));

        Integer storage = null;
        Matcher stM = STORAGE.matcher(q);
        if (stM.find()) {
            double v = Double.parseDouble(stM.group(1));
            storage = (int) (stM.group(2).equals("tb") ? v * 1024 : v);
        }

        Boolean gpu = q.matches(".*\\b(gpu|graphics card|rtx|cuda|nvidia)\\b.*") ? Boolean.TRUE : null;
        String os = q.contains("macos") || q.contains(" mac ") ? "macOS"
                : q.contains("windows") ? "Windows" : q.contains("chromeos") ? "ChromeOS" : null;

        List<String> brands = new ArrayList<>();
        for (String b : knownBrands) {
            if (b.length() >= 2 && q.contains(" " + b.toLowerCase(Locale.ROOT) + " ")) brands.add(b);
        }

        String interpreted = describe(category, useCases, max);
        String question = category == null
                ? "What kind of product are you looking for — for example a laptop, phone, headphones or an appliance?"
                : null;
        return new ShoppingIntent(interpreted, category, max, min, List.copyOf(useCases), ram, storage, gpu, os, brands, question);
    }

    static String describe(String category, Set<String> useCases, BigDecimal max) {
        String noun = category == null ? "Product" : switch (category) {
            case "laptops" -> "Laptop";
            case "smartphones" -> "Smartphone";
            case "tablets" -> "Tablet";
            case "audio" -> "Headphones or speaker";
            case "large-appliances" -> "Home appliance";
            case "health-devices" -> "Health device";
            case "books" -> "Book";
            default -> category.replace('-', ' ');
        };
        List<String> uses = useCases.stream().map(u -> switch (u) {
            case "software-development" -> "software development";
            case "ai-ml" -> "AI/ML work";
            case "content-creation" -> "content creation";
            default -> u.replace('-', ' ');
        }).toList();
        String out = noun + (uses.isEmpty() ? "" : " for " + String.join(" and ", uses));
        return max == null ? out : out + " under $" + max.stripTrailingZeros().toPlainString();
    }

    private static BigDecimal money(String digits, String k) {
        BigDecimal v = new BigDecimal(digits.replace(",", ""));
        return k != null ? v.multiply(BigDecimal.valueOf(1000)) : v;
    }
}
