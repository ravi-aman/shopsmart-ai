package com.shopsmart.knowledge;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.document.Document;
import org.springframework.ai.reader.ExtractedTextFormatter;
import org.springframework.ai.reader.pdf.PagePdfDocumentReader;
import org.springframework.ai.reader.pdf.ParagraphPdfDocumentReader;
import org.springframework.ai.reader.pdf.config.PdfDocumentReaderConfig;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.stereotype.Component;

/**
 * Turns an uploaded file into titled sections. Sections are the unit of citation ("Laptop Return
 * Policy › Opened Products"), so every parser keeps heading structure instead of raw pages.
 */
@Component
public class DocumentParser {

    public enum SourceType { PDF, MARKDOWN, JSON }

    public record Section(String title, String text) {
    }

    private final ObjectMapper mapper;

    public DocumentParser(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public List<Section> parse(byte[] content, SourceType type, String documentTitle) {
        List<Section> sections = switch (type) {
            case PDF -> pdf(content, documentTitle);
            case MARKDOWN -> markdown(new String(content, StandardCharsets.UTF_8), documentTitle);
            case JSON -> json(content, documentTitle);
        };
        List<Section> cleaned = sections.stream()
                .map(s -> new Section(s.title().strip(), normalize(s.text())))
                .filter(s -> !s.text().isBlank())
                .toList();
        if (cleaned.isEmpty()) throw new IllegalArgumentException("No readable text found in the document");
        return cleaned;
    }

    public static SourceType detect(String fileName) {
        String f = fileName.toLowerCase();
        if (f.endsWith(".pdf")) return SourceType.PDF;
        if (f.endsWith(".md") || f.endsWith(".markdown")) return SourceType.MARKDOWN;
        if (f.endsWith(".json")) return SourceType.JSON;
        throw new IllegalArgumentException("Unsupported file type — upload PDF, Markdown (.md) or JSON");
    }

    // ------------------------------------------------------------------ PDF

    private List<Section> pdf(byte[] content, String documentTitle) {
        var resource = new ByteArrayResource(content);
        var config = PdfDocumentReaderConfig.builder()
                .withPageExtractedTextFormatter(ExtractedTextFormatter.builder().withNumberOfTopTextLinesToDelete(0).build())
                .build();
        try {
            // Uses the PDF outline (bookmarks) to split by heading.
            List<Document> paragraphs = new ParagraphPdfDocumentReader(resource, config).get();
            List<Section> out = new ArrayList<>();
            for (Document d : paragraphs) {
                Map<String, Object> m = d.getMetadata();
                String title = String.valueOf(m.getOrDefault("title", documentTitle));
                String text = stripLeadingTitle(d.getText(), title);
                out.add(new Section(title.equalsIgnoreCase(documentTitle) ? "Overview" : title, text));
            }
            if (!out.isEmpty()) return out;
        } catch (RuntimeException e) {
            // No usable outline (missing, or named destinations the reader can't resolve): detect headings from text.
        }
        StringBuilder all = new StringBuilder();
        for (Document d : new PagePdfDocumentReader(resource, config).get()) {
            all.append(d.getText()).append('\n');
        }
        return headingSections(all.toString(), documentTitle);
    }

    /**
     * Splits extracted PDF text on heading-like lines (short, title-cased, no closing punctuation) and
     * re-joins lines that the PDF wrapped mid-sentence.
     */
    static List<Section> headingSections(String text, String documentTitle) {
        List<Section> out = new ArrayList<>();
        String current = "Overview";
        StringBuilder para = new StringBuilder();
        for (String raw : text.split("\\R")) {
            String line = raw.replaceAll("\\s+", " ").strip(); // PDF extraction pads words with layout spaces
            if (line.isEmpty()) continue;
            if (line.equalsIgnoreCase(documentTitle) || line.matches("(?i)^version\\s+\\S+.*effective.*")) continue;
            if (isHeading(line)) {
                if (!para.toString().isBlank()) out.add(new Section(current, para.toString()));
                para.setLength(0);
                current = line;
                continue;
            }
            if (para.length() > 0) {
                char last = para.charAt(para.length() - 1);
                para.append(".!?:".indexOf(last) >= 0 ? "\n" : " ");
            }
            para.append(line);
        }
        if (!para.toString().isBlank()) out.add(new Section(current, para.toString()));
        return out;
    }

    static boolean isHeading(String line) {
        if (line.length() < 3 || line.length() > 70) return false;
        if (".:;,".indexOf(line.charAt(line.length() - 1)) >= 0) return false;
        if (!Character.isUpperCase(line.charAt(0))) return false;
        String[] words = line.split("\\s+");
        if (words.length > 8) return false;
        int capitalised = 0;
        int counted = 0;
        for (String w : words) {
            if (w.length() <= 3 && w.equals(w.toLowerCase())) continue; // "or", "and", "on", "to"
            counted++;
            if (Character.isUpperCase(w.charAt(0)) || Character.isDigit(w.charAt(0))) capitalised++;
        }
        return counted > 0 && capitalised == counted;
    }

    private static String stripLeadingTitle(String text, String title) {
        if (text == null) return "";
        String t = text.strip();
        return t.startsWith(title) ? t.substring(title.length()).strip() : t;
    }

    // ------------------------------------------------------------------ Markdown

    /** "## Opened Products" starts a section; "###" nests as "Parent › Child"; "# Title" is the document title. */
    static List<Section> markdown(String md, String documentTitle) {
        List<Section> out = new ArrayList<>();
        String h2 = null;
        String h3 = null;
        StringBuilder buf = new StringBuilder();
        boolean inCode = false;
        for (String line : md.split("\\R")) {
            if (line.strip().startsWith("```")) {
                inCode = !inCode;
                continue;
            }
            if (!inCode && line.startsWith("### ")) {
                flush(out, h2, h3, buf);
                h3 = line.substring(4).strip();
            } else if (!inCode && line.startsWith("## ")) {
                flush(out, h2, h3, buf);
                h2 = line.substring(3).strip();
                h3 = null;
            } else if (!inCode && line.startsWith("# ")) {
                flush(out, h2, h3, buf);
            } else {
                buf.append(line.replaceFirst("^\\s*[-*+]\\s+", "• ")).append('\n');
            }
        }
        flush(out, h2, h3, buf);
        return out;
    }

    private static void flush(List<Section> out, String h2, String h3, StringBuilder buf) {
        if (!buf.toString().isBlank()) {
            String title = h2 == null ? "Overview" : h3 == null ? h2 : h2 + " › " + h3;
            out.add(new Section(title, buf.toString()));
        }
        buf.setLength(0);
    }

    // ------------------------------------------------------------------ JSON

    /** Supports {"sections":[{"title","content"}]}; anything else is flattened to "path: value" lines per top-level key. */
    private List<Section> json(byte[] content, String documentTitle) {
        JsonNode root;
        try {
            root = mapper.readTree(content);
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("Invalid JSON: " + e.getMessage());
        }
        List<Section> out = new ArrayList<>();
        JsonNode sections = root.path("sections");
        if (sections.isArray()) {
            for (JsonNode s : sections) {
                out.add(new Section(s.path("title").asText("Section"), s.path("content").asText("")));
            }
            return out;
        }
        if (root.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = root.fields();
            while (fields.hasNext()) {
                var f = fields.next();
                StringBuilder sb = new StringBuilder();
                flatten(f.getValue(), "", sb);
                out.add(new Section(humanize(f.getKey()), sb.toString()));
            }
        } else {
            StringBuilder sb = new StringBuilder();
            flatten(root, "", sb);
            out.add(new Section(documentTitle, sb.toString()));
        }
        return out;
    }

    private static void flatten(JsonNode node, String path, StringBuilder sb) {
        if (node.isObject()) {
            node.fields().forEachRemaining(e -> flatten(e.getValue(), path.isEmpty() ? humanize(e.getKey()) : path + " › " + humanize(e.getKey()), sb));
        } else if (node.isArray()) {
            for (JsonNode item : node) flatten(item, path, sb);
        } else {
            sb.append(path.isEmpty() ? "" : path + ": ").append(node.asText()).append('\n');
        }
    }

    private static String humanize(String key) {
        String spaced = key.replaceAll("([a-z])([A-Z])", "$1 $2").replace('_', ' ').replace('-', ' ');
        return spaced.isEmpty() ? spaced : Character.toUpperCase(spaced.charAt(0)) + spaced.substring(1);
    }

    static String normalize(String text) {
        return text.replace(' ', ' ')
                .replaceAll("[ \\t]+", " ")
                .replaceAll(" *\\n *", "\n")
                .replaceAll("\\n{3,}", "\n\n")
                .strip();
    }
}
