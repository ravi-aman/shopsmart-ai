package com.shopsmart.ai.shopping;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.shopsmart.catalog.CatalogDtos.ProductSummary;
import org.springframework.stereotype.Component;

/**
 * Deterministic, explainable scoring. Every point a product earns is tied to a named criterion and a
 * spec value, so "why this?" can be answered exactly — the LLM never decides the ranking.
 */
@Component
public class SpecScorer {

    public record Criterion(String name, double points, double max, String detail) {
    }

    public record Scored(ProductSummary product, int score, List<Criterion> breakdown, List<String> reasonParts,
                         List<String> matchedRequirements, List<String> tradeoffs) {
    }

    private static final Pattern RTX = Pattern.compile("(rtx|gtx)\\s*(\\d{4})", Pattern.CASE_INSENSITIVE);

    public Scored score(ProductSummary p, ShoppingIntent intent, List<String> preferredBrands) {
        Map<String, Object> s = p.specs();
        List<Criterion> c = new ArrayList<>();
        List<String> reason = new ArrayList<>();
        List<String> matched = new ArrayList<>();
        List<String> tradeoffs = new ArrayList<>();

        if (intent.budgetMax() != null) {
            matched.add("Within your $" + plain(intent.budgetMax()) + " budget at $" + plain(p.price()));
        }
        if ("Laptop".equals(s.get("type"))) {
            scoreLaptop(s, intent, c, reason, matched, tradeoffs);
        } else if ("Smartphone".equals(s.get("type"))) {
            scorePhone(s, c, reason);
        } else if ("Audio".equals(s.get("type"))) {
            scoreAudio(s, c, reason);
        } else if ("Book".equals(s.get("type"))) {
            if (s.get("author") != null) reason.add("By " + s.get("author"));
        } else {
            genericSpecs(s, reason);
        }

        double rating = p.rating() == null ? 0 : p.rating().doubleValue();
        c.add(new Criterion("Customer rating", round1(rating * 2), 10, rating + "/5 from " + p.ratingCount() + " ratings"));
        if (reason.size() < 2 && rating >= 4.0) reason.add("rated " + rating + "/5 by " + p.ratingCount() + " buyers");
        if (p.mrp() != null && p.mrp().compareTo(p.price()) > 0) {
            int off = p.mrp().subtract(p.price()).multiply(BigDecimal.valueOf(100)).divide(p.mrp(), java.math.RoundingMode.HALF_UP).intValue();
            c.add(new Criterion("Deal", Math.min(5, off / 4.0), 5, off + "% below list price"));
        } else {
            c.add(new Criterion("Deal", 0, 5, "No current discount"));
        }

        List<String> wanted = !intent.brands().isEmpty() ? intent.brands() : preferredBrands;
        if (!wanted.isEmpty()) {
            boolean hit = wanted.stream().anyMatch(b -> b.equalsIgnoreCase(p.brand()));
            c.add(new Criterion("Brand preference", hit ? 5 : 0, 5, hit ? p.brand() + " is a brand you prefer" : "Not one of your preferred brands"));
            if (hit) matched.add("From " + p.brand() + ", a brand you prefer");
        }
        if (p.availability() != null) matched.add(p.availability() == com.shopsmart.catalog.CatalogDtos.Availability.LOW_STOCK
                ? "In stock (only a few left)" : "In stock");

        double got = c.stream().mapToDouble(Criterion::points).sum();
        double max = c.stream().mapToDouble(Criterion::max).sum();
        int score = (int) Math.round(max == 0 ? 0 : got / max * 100);
        return new Scored(p, score, c, reason.stream().limit(4).toList(), matched, tradeoffs);
    }

    // ------------------------------------------------------------------ laptops

    private void scoreLaptop(Map<String, Object> s, ShoppingIntent intent, List<Criterion> c, List<String> reason,
                             List<String> matched, List<String> tradeoffs) {
        boolean ai = intent.has("ai-ml");
        boolean dev = intent.has("software-development");
        boolean gpuWork = ai || intent.has("gaming") || intent.has("content-creation") || Boolean.TRUE.equals(intent.needsDedicatedGpu());
        boolean mobile = intent.has("travel") || intent.has("student");

        int ram = num(s.get("ramGb"));
        double ramPts = ram >= 32 ? 25 : ram >= 16 ? (ai ? 19 : 21) : ram >= 12 ? 14 : ram >= 8 ? (ai || dev ? 5 : 9) : 2;
        c.add(new Criterion("Memory", ramPts, 25, ram + " GB RAM"));
        if (ram > 0) reason.add(ram + "GB RAM");
        if (ram >= 16 && (ai || dev)) matched.add(ram + "GB RAM handles IDEs, builds and AI tooling");
        if (ram > 0 && ram < 16 && (ai || dev)) tradeoffs.add(ram + "GB RAM is tight for large IDE projects and AI libraries");

        String cpu = str(s.get("cpu"));
        int tier = cpuTier(cpu);
        c.add(new Criterion("Processor", tier == 3 ? 20 : tier == 2 ? 13 : 6, 20, cpu));
        if (!cpu.isEmpty()) reason.add(cpuShort(cpu));
        if (tier == 3 && dev) matched.add("High-performance CPU for fast compiles");

        int storage = num(s.get("storageGb"));
        String type = str(s.get("storageType"));
        boolean ssd = type.equalsIgnoreCase("SSD");
        double stPts = !ssd ? 2 : storage >= 1024 ? 15 : storage >= 512 ? 12 : storage >= 256 ? 7 : 4;
        c.add(new Criterion("Storage", stPts, 15, (storage >= 1024 ? storage / 1024 + " TB " : storage + " GB ") + type));
        if (ssd) reason.add("SSD storage");
        if (!ssd) tradeoffs.add(type + " storage is much slower than an SSD");

        String gpu = str(s.get("gpu"));
        Matcher m = RTX.matcher(gpu);
        int gpuModel = m.find() ? Integer.parseInt(m.group(2)) : 0;
        boolean discrete = gpuModel > 0 || gpu.toLowerCase(Locale.ROOT).contains("radeon rx");
        if (gpuWork) {
            double gpuPts = gpuModel >= 4070 ? 20 : gpuModel >= 4060 ? 17 : gpuModel >= 4050 ? 15 : gpuModel > 0 ? 9
                    : gpu.startsWith("Apple") ? 8 : 3;
            c.add(new Criterion("Graphics", gpuPts, 20, gpu));
            if (discrete) {
                reason.add(gpu.replace("NVIDIA GeForce ", "NVIDIA ") + " GPU");
                if (ai) matched.add("Dedicated NVIDIA GPU with CUDA for ML experiments");
            } else if (ai) {
                tradeoffs.add("Integrated graphics — fine for learning and cloud notebooks, not for local GPU training");
            }
        }

        String os = str(s.get("os"));
        if (dev || ai) {
            double fit = os.contains("ChromeOS") ? 0 : os.contains("Arm") ? 5 : os.startsWith("macOS") && ai ? 7 : 10;
            c.add(new Criterion("Developer platform", fit, 10, os));
            if (os.contains("ChromeOS")) tradeoffs.add("ChromeOS cannot run full desktop IDEs like IntelliJ");
            if (os.contains("Arm")) tradeoffs.add("Windows on Arm runs some x86 developer tools under emulation");
        }

        double weight = dbl(s.get("weightKg"));
        int battery = num(s.get("batteryHours"));
        if (mobile) {
            double wPts = weight <= 1.3 ? 10 : weight <= 1.6 ? 7 : weight <= 2.0 ? 4 : 1;
            c.add(new Criterion("Portability", wPts, 10, weight + " kg"));
            if (weight > 2.0) tradeoffs.add("Heavy to carry daily (" + weight + " kg)");
        }
        c.add(new Criterion("Battery", battery >= 15 ? 5 : battery >= 10 ? 4 : battery >= 8 ? 3 : 1, 5, "Up to " + battery + " h"));
    }

    static int cpuTier(String cpu) {
        String x = cpu.toLowerCase(Locale.ROOT);
        if (x.matches(".*(i7|i9|ryzen [79]|ultra [79]|apple m[1-4] (pro|max)|apple m3|apple m4|snapdragon x elite).*")) return 3;
        if (x.matches(".*(i5|ryzen 5|ultra 5|core 5|core 7|apple m[12]|snapdragon x plus).*")) return 2;
        return 1;
    }

    /** "Intel Core i7-1355U (10 cores)" → "Intel i7 processor"; "Apple M3 (8-core CPU)" → "Apple M3 chip". */
    static String cpuShort(String cpu) {
        String base = cpu.replaceAll("\\s*\\(.*\\)", "").trim();
        Matcher intel = Pattern.compile("Intel Core (i\\d)").matcher(base);
        if (intel.find()) return "Intel " + intel.group(1) + " processor";
        Matcher ultra = Pattern.compile("Intel Core (Ultra \\d)").matcher(base);
        if (ultra.find()) return "Intel Core " + ultra.group(1) + " processor";
        Matcher ryzen = Pattern.compile("AMD (Ryzen \\d)").matcher(base);
        if (ryzen.find()) return "AMD " + ryzen.group(1) + " processor";
        if (base.startsWith("Apple")) return base + " chip";
        return base + " processor";
    }

    // ------------------------------------------------------------------ other categories

    private void scorePhone(Map<String, Object> s, List<Criterion> c, List<String> reason) {
        int ram = num(s.get("ramGb"));
        int storage = num(s.get("storageGb"));
        int cam = num(s.get("mainCameraMp"));
        int battery = num(s.get("batteryMah"));
        c.add(new Criterion("Memory", ram >= 12 ? 10 : ram >= 8 ? 7 : 3, 10, ram + " GB RAM"));
        c.add(new Criterion("Storage", storage >= 256 ? 10 : storage >= 128 ? 7 : 3, 10, storage + " GB"));
        c.add(new Criterion("Battery", battery >= 5000 ? 10 : battery >= 4000 ? 7 : 4, 10, battery + " mAh"));
        c.add(new Criterion("Camera", cam >= 50 ? 10 : cam >= 48 ? 8 : 5, 10, cam + " MP main camera"));
        if (ram > 0) reason.add(ram + "GB RAM");
        if (storage > 0) reason.add(storage + "GB storage");
        if (battery > 0) reason.add(battery + "mAh battery");
        if (cam > 0) reason.add(cam + "MP camera");
    }

    private void scoreAudio(Map<String, Object> s, List<Criterion> c, List<String> reason) {
        boolean anc = Boolean.TRUE.equals(s.get("noiseCancelling"));
        int battery = num(s.get("batteryHours"));
        c.add(new Criterion("Noise cancelling", anc ? 10 : 2, 10, anc ? "Active noise cancelling" : "No ANC"));
        c.add(new Criterion("Battery", battery >= 24 ? 10 : battery >= 10 ? 7 : 4, 10, "Up to " + battery + " h"));
        if (anc) reason.add("active noise cancelling");
        if (battery > 0) reason.add(battery + "-hour battery");
        if (s.get("formFactor") != null) reason.add(String.valueOf(s.get("formFactor")).toLowerCase(Locale.ROOT) + " design");
    }

    private void genericSpecs(Map<String, Object> s, List<String> reason) {
        for (String k : List.of("capacityKg", "capacityLitres", "capacityTon", "energyRating", "technology", "measurement", "formFactor")) {
            Object v = s.get(k);
            if (v == null) continue;
            reason.add(switch (k) {
                case "capacityKg" -> v + " kg capacity";
                case "capacityLitres" -> v + " L capacity";
                case "capacityTon" -> v + " ton capacity";
                case "energyRating" -> v + " energy rating";
                default -> String.valueOf(v);
            });
        }
    }

    // ------------------------------------------------------------------ helpers

    private static int num(Object v) {
        if (v instanceof Number n) return n.intValue();
        try {
            return v == null ? 0 : (int) Double.parseDouble(v.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static double dbl(Object v) {
        if (v instanceof Number n) return n.doubleValue();
        try {
            return v == null ? 0 : Double.parseDouble(v.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String str(Object v) {
        return v == null ? "" : v.toString();
    }

    private static double round1(double v) {
        return Math.round(v * 10) / 10.0;
    }

    static String plain(BigDecimal v) {
        return v.stripTrailingZeros().toPlainString();
    }
}
