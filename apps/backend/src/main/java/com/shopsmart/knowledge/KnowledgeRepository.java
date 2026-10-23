package com.shopsmart.knowledge;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.shopsmart.common.Json;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class KnowledgeRepository {

    static final String DOC_COLUMNS = """
            id, title, category, region, version, effective_date, applies_to_tiers, source_type, file_name, storage_path,
            checksum, status, error_message, chunk_count, is_active, created_at
            """;

    private final JdbcClient jdbc;
    private final Json json;

    public KnowledgeRepository(JdbcClient jdbc, Json json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public record DocumentRow(UUID id, String title, String category, String region, String version, LocalDate effectiveDate,
                              List<String> tiers, String sourceType, String fileName, String storagePath, String checksum,
                              String status, String errorMessage, int chunkCount, boolean active, OffsetDateTime createdAt) {
    }

    public record NewDocument(String title, String category, String region, String version, LocalDate effectiveDate,
                              List<String> tiers, String sourceType, String fileName, String storagePath, String checksum,
                              UUID uploadedBy) {
    }

    public UUID insert(NewDocument d) {
        return jdbc.sql("""
                        insert into documents (title, category, region, version, effective_date, applies_to_tiers, source_type,
                            file_name, storage_path, checksum, uploaded_by, is_active)
                        values (:title, :category, :region, :version, :eff, :tiers, :type, :file, :path, :checksum, :by, false)
                        returning id
                        """)
                .param("title", d.title()).param("category", d.category()).param("region", d.region())
                .param("version", d.version()).param("eff", d.effectiveDate()).param("tiers", d.tiers().toArray(String[]::new))
                .param("type", d.sourceType()).param("file", d.fileName()).param("path", d.storagePath())
                .param("checksum", d.checksum()).param("by", d.uploadedBy())
                .query(UUID.class).single();
    }

    public Optional<DocumentRow> findByChecksum(String checksum) {
        return jdbc.sql("select " + DOC_COLUMNS + " from documents where checksum = :c").param("c", checksum).query(this::map).optional();
    }

    public boolean existsTitleVersion(String title, String version) {
        return jdbc.sql("select count(*) from documents where lower(title) = lower(:t) and version = :v")
                .param("t", title).param("v", version).query(Long.class).single() > 0;
    }

    public Optional<DocumentRow> find(UUID id) {
        return jdbc.sql("select " + DOC_COLUMNS + " from documents where id = :id").param("id", id).query(this::map).optional();
    }

    public List<DocumentRow> list() {
        return jdbc.sql("select " + DOC_COLUMNS + " from documents order by title, effective_date desc, created_at desc").query(this::map).list();
    }

    public long count() {
        return jdbc.sql("select count(*) from documents").query(Long.class).single();
    }

    public void setStatus(UUID id, String status, String error) {
        jdbc.sql("update documents set status = :s, error_message = :e where id = :id")
                .param("s", status).param("e", error).param("id", id).update();
    }

    public void replaceChunks(UUID documentId, List<Map<String, Object>> metadata, List<String> contents, List<String> vectors) {
        jdbc.sql("delete from vector_store where metadata ->> 'documentId' = :d").param("d", documentId.toString()).update();
        for (int i = 0; i < contents.size(); i++) {
            jdbc.sql("insert into vector_store (content, metadata, embedding) values (:c, cast(:m as json), cast(:v as vector))")
                    .param("c", contents.get(i))
                    .param("m", json.write(metadata.get(i)))
                    .param("v", vectors.get(i))
                    .update();
        }
        jdbc.sql("update documents set chunk_count = :n where id = :id").param("n", contents.size()).param("id", documentId).update();
    }

    /**
     * Exactly one version per title is active: the READY one with the latest effective date that is
     * already in force. Chunk metadata mirrors the flag so retrieval never mixes versions.
     */
    public void refreshActiveVersion(String title) {
        jdbc.sql("""
                        update documents d set is_active = (d.id = (
                            select id from documents
                            where lower(title) = lower(:t) and status = 'READY' and effective_date <= current_date
                            order by effective_date desc, created_at desc limit 1))
                        where lower(d.title) = lower(:t)
                        """)
                .param("t", title).update();
        jdbc.sql("""
                        update vector_store v set metadata = jsonb_set(v.metadata::jsonb, '{active}', to_jsonb(d.is_active))::json
                        from documents d where d.id::text = v.metadata ->> 'documentId' and lower(d.title) = lower(:t)
                        """)
                .param("t", title).update();
    }

    public List<ChunkRow> chunks(UUID documentId) {
        return jdbc.sql("""
                        select id, content, metadata::text as metadata, embedding is not null as embedded from vector_store
                        where metadata ->> 'documentId' = :d order by (metadata ->> 'chunkIndex')::int
                        """)
                .param("d", documentId.toString())
                .query((rs, n) -> new ChunkRow(rs.getObject("id", UUID.class), rs.getString("content"),
                        json.toMap(rs.getString("metadata")), rs.getBoolean("embedded")))
                .list();
    }

    public Optional<ChunkRow> chunk(UUID chunkId) {
        return jdbc.sql("select id, content, metadata::text as metadata, embedding is not null as embedded from vector_store where id = :id")
                .param("id", chunkId)
                .query((rs, n) -> new ChunkRow(rs.getObject("id", UUID.class), rs.getString("content"),
                        json.toMap(rs.getString("metadata")), rs.getBoolean("embedded")))
                .optional();
    }

    public List<ChunkRow> chunksWithoutEmbedding(int limit) {
        return jdbc.sql("select id, content, metadata::text as metadata, false as embedded from vector_store where embedding is null limit :n")
                .param("n", limit)
                .query((rs, n) -> new ChunkRow(rs.getObject("id", UUID.class), rs.getString("content"),
                        json.toMap(rs.getString("metadata")), false))
                .list();
    }

    public void setEmbedding(UUID chunkId, String vector) {
        jdbc.sql("update vector_store set embedding = cast(:v as vector) where id = :id").param("v", vector).param("id", chunkId).update();
    }

    public record ChunkRow(UUID id, String content, Map<String, Object> metadata, boolean embedded) {
    }

    private DocumentRow map(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new DocumentRow(
                rs.getObject("id", UUID.class), rs.getString("title"), rs.getString("category"), rs.getString("region"),
                rs.getString("version"), rs.getObject("effective_date", LocalDate.class),
                List.of((String[]) rs.getArray("applies_to_tiers").getArray()), rs.getString("source_type"),
                rs.getString("file_name"), rs.getString("storage_path"), rs.getString("checksum"), rs.getString("status"),
                rs.getString("error_message"), rs.getInt("chunk_count"), rs.getBoolean("is_active"),
                rs.getObject("created_at", OffsetDateTime.class));
    }
}
