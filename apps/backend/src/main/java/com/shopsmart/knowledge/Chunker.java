package com.shopsmart.knowledge;

import java.util.ArrayList;
import java.util.List;

import org.springframework.ai.document.Document;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.stereotype.Component;

/**
 * Section-aware chunking: a chunk never crosses a section boundary, long sections are split with
 * Spring AI's {@link TokenTextSplitter}, and every chunk is prefixed with a context header
 * ("Laptop Return Policy v2026.1 › Opened Products") so it is retrievable on its own.
 */
@Component
public class Chunker {

    static final int CHUNK_TOKENS = 350;
    /** Sections shorter than this many characters stay whole. */
    static final int SPLIT_ABOVE_CHARS = 1600;

    private final TokenTextSplitter splitter = TokenTextSplitter.builder()
            .withChunkSize(CHUNK_TOKENS)
            .withMinChunkSizeChars(200)
            .withMinChunkLengthToEmbed(10)
            .withMaxNumChunks(1000)
            .withKeepSeparator(true)
            .build();

    public record Chunk(int index, String section, String body, String content) {
    }

    public List<Chunk> chunk(String documentTitle, String version, List<DocumentParser.Section> sections) {
        List<Chunk> out = new ArrayList<>();
        for (var s : sections) {
            List<String> bodies = s.text().length() <= SPLIT_ABOVE_CHARS
                    ? List.of(s.text())
                    : splitter.apply(List.of(new Document(s.text()))).stream().map(Document::getText).toList();
            for (String body : bodies) {
                String header = documentTitle + " v" + version + " › " + s.title();
                out.add(new Chunk(out.size(), s.title(), body.strip(), header + "\n" + body.strip()));
            }
        }
        return out;
    }
}
