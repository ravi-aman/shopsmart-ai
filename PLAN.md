# ShopSmart AI — Implementation Plan (Hackathon stack, monorepo)

Source brief: `ShopSmartAI_Hackathon_Usecase.docx`
Stack (exactly as the brief recommends):

| Layer | Choice (pinned) |
|---|---|
| Frontend | **React 19 + Vite 8** + TypeScript |
| Backend | **Java 21 + Spring Boot 3.5.16 + Spring AI 1.1.8** (Maven) |
| Database | **Supabase Postgres + pgvector** (JDBC via Supabase session pooler; optional offline `pgvector/pgvector:pg17` container) |
| AI models | **NVIDIA API** (`integrate.api.nvidia.com`, OpenAI-compatible) via Spring AI OpenAI starter |

Goal: one monorepo that covers **every** requirement in the brief — Module 1 (AI shopping), Module 2 (RAG knowledge assistant), and the challenge items the brief lists without detail (order tracking, operations agents, explainable + auditable AI).

---

## 1. Monorepo layout

```
full-stack/                         (repo root)
├─ apps/
│  ├─ backend/                      Spring Boot 3.5 + Spring AI (Maven wrapper)
│  │  └─ src/main/java/com/shopsmart/
│  │     ├─ ShopSmartApplication.java
│  │     ├─ common/       (errors → ProblemDetail, pagination, validation)
│  │     ├─ security/     (JWT, roles CUSTOMER/ADMIN/OPS)
│  │     ├─ customer/     (auth, users, membership tier, preferences)
│  │     ├─ catalog/      (categories, brands, products, search, facets, compare)
│  │     ├─ cart/  wishlist/
│  │     ├─ inventory/    (warehouses, stock, movements, forecast)
│  │     ├─ order/        (checkout sim, shipments, delivery events, returns)
│  │     ├─ promotion/
│  │     ├─ knowledge/    (documents, ETL ingestion, hybrid retrieval, Q&A)
│  │     ├─ ai/
│  │     │  ├─ config/    (ChatClient beans, NVIDIA embedding model)
│  │     │  ├─ agent/     (Orchestrator, Shopping, Knowledge, Order, Ops)
│  │     │  ├─ tools/     (@Tool classes per domain)
│  │     │  ├─ advisor/   (AuditAdvisor, guardrails)
│  │     │  └─ dto/       (output contracts — Module 1/2 JSON)
│  │     └─ audit/        (ai_audit_log, feedback, viewer API)
│  │  └─ src/main/resources/
│  │     ├─ application.yml
│  │     ├─ db/migration/ (Flyway V1__schema.sql, V2__seed.sql …)
│  │     └─ prompts/      (*.st prompt templates)
│  └─ frontend/                     React 19 + Vite + TS
│     └─ src/
│        ├─ app/          (router, providers, layout)
│        ├─ features/     (catalog, search, product, compare, cart, wishlist,
│        │                 assistant, knowledge, orders, account, admin/*)
│        ├─ components/ui/ (shadcn-based design system)
│        ├─ lib/          (api client, query keys, sse, format)
│        └─ styles/
├─ infra/
│  ├─ docker-compose.yml           (postgres+pgvector, backend, frontend)
│  └─ db/init.sql                  (CREATE EXTENSION vector, pg_trgm)
├─ knowledge/                      seed policy docs (PDF / MD / JSON)
├─ data/                           seed catalog JSON (products, warehouses)
├─ docs/                           architecture.md (diagram), setup.md, demo-script.md, api.md
├─ .env.example
├─ package.json                    root scripts (dev, build, db:up …)
└─ README.md
```

---

## 2. Backend stack details

| Concern | Choice | Notes |
|---|---|---|
| Web | Spring MVC, virtual threads on (`spring.threads.virtual.enabled=true`) | SSE streaming for assistant via `Flux<ServerSentEvent>` |
| Persistence | Spring JDBC `JdbcClient` with hand-written SQL (hybrid search, facets, RRF) | Flyway owns the schema |
| Validation / errors | Jakarta Validation + `@RestControllerAdvice` returning RFC 7807 `ProblemDetail` | One error shape everywhere |
| Security | Spring Security + OAuth2 Resource Server (self-issued HS256 JWT) | Roles CUSTOMER / ADMIN / OPS; membership tier as claim |
| AI | Spring AI `ChatClient`, `@Tool`, structured output `.entity(Record.class)`, advisors, `JdbcChatMemoryRepository` | |
| RAG ETL | Spring AI document readers: `PagePdfDocumentReader`, `MarkdownDocumentReader`, `JsonReader` + `TokenTextSplitter` | Metadata: version, effectiveDate, category, region, tiers |
| Vector store | Spring AI `PgVectorStore` (HNSW, cosine, 1024 dims) + our `tsvector` column for keyword search | Filter expressions for tier/region/category |
| Jobs | `@Scheduled` (delivery simulator, nightly forecast), `@Async` ingestion | |
| API docs | springdoc-openapi → Swagger UI at `/swagger-ui.html` | Judges can try every endpoint |
| Rate limit | Bucket4j on `/api/ai/**` | |
| Tests | JUnit 5, MockMvc, **Testcontainers (pgvector image)**, RAG eval runner | |

### NVIDIA models (configurable via env)

| Purpose | Default model | Why |
|---|---|---|
| Agent / reasoning / tool calling | `nvidia/nemotron-3-super-120b-a12b` | Strong agentic model, tool calling |
| Fast tasks (intent extraction, query rewrite, confidence check) | `nvidia/nemotron-3.5-lightning-30b-a3b` | Cheap + fast |
| Embeddings | `nvidia/embed-qa-4` (**1024 dims**) | Retrieval-tuned; asymmetric (`input_type=query/passage`). Can switch to a Matryoshka model (e.g. llama-nemotron-embed-1b-v2 at 1024 with `EMBEDDING_SEND_DIMENSIONS=true`) — verify with `/api/health/ai` |
| Safety (optional) | `nvidia/llama-3.1-nemoguard-8b-content-safety` | Input guardrail demo |

Integration notes (important):
- Chat goes through **Spring AI OpenAI starter** with `base-url: https://integrate.api.nvidia.com`. NVIDIA requires `max-tokens` to be set explicitly.
- NVIDIA retrieval embedders require an `input_type` field that the OpenAI client doesn't send, so we write a small **`NvidiaEmbeddingModel implements EmbeddingModel`** (RestClient): documents → `passage`, search query → `query`. OpenAI embedding auto-config is disabled.
- All model ids in `application.yml` from env vars, so any model on build.nvidia.com can be swapped without code changes.

---

## 3. UI direction — borrow from platforms that already do this well

Not a generic purple AI chat page. Each surface copies a proven product:

| Surface | Reference | What we take |
|---|---|---|
| Header, search, category mega-menu, listing grid | **Amazon / Flipkart** | Dense scannable grid, left filter rail, price + rating + delivery date on card |
| Product page | **Apple Store / Best Buy** | Large gallery, spec table, sticky buy box, "Delivery by Thu" |
| Compare | **Best Buy / GSMArena** | Side-by-side spec table, "differences only" toggle, best-value highlights |
| AI Shopping Assistant | **Amazon Rufus / Perplexity Shopping** | Right-side drawer on every page; answers as **product cards + reason chips** |
| Policy answers | **Perplexity** | Answer with `[1]` citations → opens document section, version, effective date |
| Order tracking | **Flipkart / Shopify order status** | Vertical timeline with times, carrier, ETA |
| Admin / Ops console | **Shopify Polaris / Linear** | Calm neutral palette, data tables, KPI tiles |

Visual system: off-white surface, near-black text, **one** accent colour, green only for "In stock", red only for stock-outs; Inter/Geist with tabular numbers for prices; an "AI" badge + "Why this?" link on every AI answer (opens explanation drawer = explainability). Mobile: bottom nav (Home, Search, Assistant, Cart, Account), assistant as a full-height sheet.

Frontend libraries: React Router 7, TanStack Query, Zustand (UI/cart state), React Hook Form + Zod, Tailwind CSS 4 + shadcn/ui (re-themed), Motion, TanStack Table (admin), Recharts (ops KPIs).

---

## 4. Architecture

```
React 19 SPA (Vite)
   │  REST + SSE (JWT)
   ▼
Spring Boot 3.5 ───────────────────────────────────────────────
 Controllers → Services → Repositories (JPA / JdbcClient) → PostgreSQL + pgvector
      │
      └─ AI layer (Spring AI)
           OrchestratorAgent ─► routes intent to:
              ShoppingAgent   (tools: searchProducts, getProduct, compare, checkStock, prefs)
              KnowledgeAgent  (tools: searchKnowledge → hybrid RAG)
              OrderAgent      (tools: myOrders, trackShipment, requestReturn*, cancelOrder*)
              OpsAgent        (tools: inventory, forecastStockout, fulfillmentIssues, suggestPromotion*)
           AuditAdvisor  → ai_audit_log (every call: input, tools, chunks, output, tokens, latency)
           ChatClient ──► NVIDIA API (chat)   NvidiaEmbeddingModel ──► NVIDIA API (embeddings)
 Schedulers: delivery-event simulator, stock forecast
```
`*` write actions never execute directly: the agent returns a **proposed action**; user clicks Confirm; a normal REST endpoint performs it. Safe agents = strong demo point.

---

## 5. Database schema (Flyway)

**Identity:** `users` (id, name, email, password_hash, role, membership_tier `BASIC|PRIME|PREMIUM`, region) · `user_preferences` (categories[], brands[], budget_min/max, use_cases[])

**Catalog:** `categories` (id, parent_id, slug, name, path) · `brands` · `products` (id like `LAP101`, name, slug, category_id, brand_id, description, price, mrp, rating, rating_count, images jsonb, specs jsonb, tags[], search_tsv tsvector generated, embedding vector(1024)) — indexes: GIN tsv, GIN trigram name, HNSW embedding, (category_id, price), GIN specs

**Inventory:** `warehouses` (id, name, city, region) · `inventory` (product_id, warehouse_id, on_hand, reserved, reorder_point) · `stock_movements` (delta, reason, created_at). Availability derived: `IN_STOCK | LOW_STOCK | OUT_OF_STOCK`.

**Shopping:** `carts`, `cart_items`, `wishlists`, `orders` (status PLACED→PACKED→SHIPPED→OUT_FOR_DELIVERY→DELIVERED, plus CANCELLED / RETURN_REQUESTED / RETURNED / REFUNDED), `order_items`, `shipments`, `shipment_events`, `return_requests`, `promotions` (DRAFT|ACTIVE|ENDED, created_by human|agent)

**Knowledge:** `documents` (title, category RETURN|SHIPPING|REFUND|WARRANTY|MEMBERSHIP|MANUAL|SELLER|SLA, region, version, effective_date, applies_to_tiers[], source_type pdf|md|json, file_path, checksum, status UPLOADED|PROCESSING|READY|FAILED, is_active) · `vector_store` (Spring AI table: id, content, metadata jsonb, embedding vector(1024)) **+ our generated `content_tsv` column** for keyword search

**AI / audit:** `ai_audit_log` (agent, intent, input, extracted_params, tool_calls, retrieved_chunk_ids, scores, output, confidence, model, tokens, latency_ms, human_approved) · `ai_feedback` · `SPRING_AI_CHAT_MEMORY` (Spring AI JDBC memory)

---

## 6. Module 1 — AI Product Discovery & Shopping

### 6.1 Commerce core (judges click this first — must be solid)
Catalog, category hierarchy, search (full-text + trigram typo tolerance + vector, fused with **Reciprocal Rank Fusion** in one SQL), facets (brand, price buckets, rating, availability, spec keys like RAM/CPU), sorting, pagination (Spring `Pageable`), compare (up to 4, "differences only"), wishlist, cart (guest cart merged on login), customer preferences, login/register, responsive UI. Filters live in the URL query string (shareable, back-button safe).

### 6.2 AI Shopping Assistant pipeline
1. **Requirement extraction** (fast model, `.entity(ShoppingIntent.class)`): category, budget, use cases, must-have specs, brands, ambiguity.
2. **Clarify or continue**: missing critical field → return `clarifyingQuestion`, stop.
3. **Candidate retrieval in SQL** (not LLM): hard filters (category, price ≤ budget, in stock) + hybrid rank on use-case text → top 20.
4. **Deterministic spec scoring**: use-case → weighted rules (e.g. "AI projects" → RAM ≥ 16 GB, GPU bonus; "Java dev" → CPU cores, RAM, SSD). Numeric score = explainable.
5. **LLM rerank + reasons** (agent model): reasons must cite only spec fields that exist; validator drops anything not backed by specs.
6. **Live availability** from inventory.
7. Return the **exact contract**:
```json
{
  "interpretedRequirement": "Laptop for Java development and AI learning",
  "budget": 1000,
  "recommendations": [
    { "productId": "LAP101", "productName": "Dell Inspiron 15",
      "reason": "16GB RAM, Intel i7 processor, SSD storage", "availability": "IN_STOCK" }
  ],
  "clarifyingQuestion": null
}
```
Extra non-breaking fields for UI: `score`, `matchedRequirements`, `auditId`.

Endpoint: `POST /api/ai/shopping/recommend` (JSON) and `POST /api/ai/assistant/stream` (SSE with progress steps: "Understanding need → Searching 412 laptops → Checking stock").

---

## 7. Module 2 — RAG Knowledge Assistant

### 7.1 Ingestion (Spring AI ETL pipeline)
- `POST /api/admin/documents` (multipart): file + metadata (title, category, version, effectiveDate, region, tiers). Checksum dedupe. Status polled by UI.
- **Read**: PDF → `PagePdfDocumentReader` (paragraph reader when PDF has outline); Markdown → `MarkdownDocumentReader` (keeps heading as section); JSON → `JsonReader` with chosen keys.
- **Transform**: heading-aware split, then `TokenTextSplitter` (~600 tokens, overlap); each chunk gets a **context header** ("Laptop Return Policy v2026.1 › Opened Products") before embedding — big recall boost. Metadata on every chunk: documentId, document, section, version, effectiveDate, category, region, tiers.
- **Load**: `PgVectorStore.add()` → NVIDIA embeddings (`passage`).
- **Versioning**: new version of the same document deactivates the old (kept for audit).

### 7.2 Retrieval
- Query rewrite (fast model) using chat history → standalone query + category hint.
- **Hybrid**: vector top-20 (`SearchRequest` + filter expression `active == true && region in [...] && tiers contains user tier`) + keyword top-20 (`content_tsv`) → **RRF** → top 5. Implemented as a custom Spring AI `DocumentRetriever`, so it also plugs into `RetrievalAugmentationAdvisor`.

### 7.3 Grounded answer
- Prompt: answer **only** from the numbered context; cite chunk ids; if not present, say so.
- `.entity(KnowledgeAnswer.class)` → exact contract:
```json
{
  "answer": "Opened laptops can be returned within 7 days if physical damage is not present.",
  "confidence": "HIGH",
  "sources": [{ "document": "Laptop Return Policy", "section": "Opened Products", "version": "2026.1" }],
  "followUpRequired": false
}
```
- **Confidence computed in code**, not just model opinion: top similarity, score gap, number of agreeing chunks, citation validity (every cited id must be in the retrieved set).
- LOW / nothing found → "I couldn't find this in approved policies", `followUpRequired: true` (support ticket stub). Never invents policy.
- Product questions ("warranty of this smartphone") resolve product → brand/category first, then filter manuals/warranty docs.

### 7.4 Seed knowledge (we write it, realistic, mixed formats)
Return policy (MD), Laptop return policy — opened products (PDF), Shipping policy (MD), Delivery SLA by region (JSON), Refund timelines (PDF), Warranty (phones/laptops/appliances) (JSON), Membership benefits Basic/Prime/Premium (MD — free-delivery rules differ by tier), Cancellation before/after shipment (MD), Seller guidelines (PDF), 2–3 product manuals. One **older version** of a policy to demo versioning. All 5 example questions from the brief must be answerable.

---

## 8. Orders, tracking, operations

- **Checkout (simulated)**: no payment; reserve stock from nearest warehouse; create shipment with promised date from SLA rules.
- **Delivery simulator**: `@Scheduled` advances shipments through events, sometimes injects delays; admin "Simulate next event" button for live demo.
- **Tracking page**: timeline + ETA; Order Agent answers "where is my order / can I cancel".
- **Ops console** (`/admin`): KPI tiles (orders, delayed shipments, low-stock SKUs, LOW-confidence answers), inventory across warehouses, **stock-out forecast** (deterministic: 14-day avg sales → days of cover vs lead time; LLM only explains + recommends), fulfillment issue queue → Ops Agent proposes fix → human approves, promotion suggestions for overstock (DRAFT → admin activates), **AI Audit viewer** (every decision: input, extracted params, tools, chunks, output, tokens, latency, feedback).

---

## 9. Quality bars

- Validation on every DTO; AI outputs validated after `.entity()`; one `ProblemDetail` error format.
- AI calls: timeout, one retry, fallback model; UI degrades gracefully ("showing regular search results").
- Security: method-level `@PreAuthorize` on admin APIs; rate limit AI endpoints; retrieved text treated as data (prompt-injection safe); write tools need confirmation; upload type/size checks.
- **RAG eval**: `golden.json` with ~30 questions (brief's 5 + wrong tier, old version, unanswerable) → accuracy, citation correctness, refusal correctness; publish score in README.
- Tests: Testcontainers integration tests for search + RAG; Playwright e2e for search→compare→cart→checkout→track and assistant flows.

---

## 10. Seed data
~400 products across Electronics, Fashion, Home appliances, Books, Healthcare, Groceries with realistic `specs` JSON (committed JSON, deterministic seeding). Must include `LAP101 Dell Inspiron 15` (16 GB, i7, SSD, $899) and near-miss laptops. 5 warehouses, 60 days of stock movements for forecasting. Demo users per tier + admin.

---

## 11. Build phases

| Phase | Scope | Done when |
|---|---|---|
| **P0 Setup** ✅ | Monorepo, Supabase config, Spring Boot + Spring AI + Flyway schema, NVIDIA chat + embedding model, Vite React shell, root scripts | Done — backend builds, Flyway V1 applies, `/api/health` UP with pgvector; frontend builds. NVIDIA round-trip (`/api/health/ai`) pending an API key |
| **P1 Commerce core** ✅ | Schema, seed, auth, catalog, search, facets, PDP, cart, wishlist, compare, prefs, responsive UI | Full shopping flow without AI |
| **P2 Module 1 AI** ✅ | Product embeddings, hybrid search, intent extraction, scoring, reasons, assistant drawer, audit | Done — brief query returns the exact JSON; works without NVIDIA via rule-based fallback; NVIDIA path untested until a key is added |
| **P3 Module 2 RAG** | Upload, ETL (PDF/MD/JSON), hybrid retrieval, grounded answer, confidence, citations, versioning, seed docs | All 5 example questions answered with sources |
| **P4 Orders + Agents** | Checkout sim, shipments, scheduler, tracking, orchestrator + agents, confirm-to-act | "Where's my order and can I return it?" works end to end |
| **P5 Ops console** | Inventory, forecast, fulfillment, promotions, audit viewer, KPIs | Admin demo story works |
| **P6 Deliverables** | RAG eval, tests, architecture diagram, setup docs, demo script, reset-demo button | Fresh clone → documented commands → working app |

---

## 12. Demo script (5 min)
1. Prime user searches "laptop", filters, compares 3.
2. Assistant: "Suggest a laptop under $1000 for Java development and AI projects" → cards + reasons → "Why this?" shows score breakdown.
3. "Can I return an opened laptop?" → cited answer → click citation → section, version 2026.1.
4. "Does Prime include free delivery?" as Prime vs Basic → different, correctly cited answers.
5. Place order → simulate event → "Where's my order and can I cancel it?" → shipped, cancel not allowed (cited), offers return.
6. Admin uploads a new policy PDF live → READY → ask → new answer.
7. Ops: stock-out forecast → agent proposes warehouse transfer → approve → audit log shows full trace.

---

## 13. Local prerequisites & risks
- **JDK 21** (machine currently has only JDK 11) — install Temurin 21, or build/run the backend through Docker (`apps/backend/Dockerfile`). Maven comes via `mvnw`.
- **Supabase project** with the `vector` extension available; DB credentials in `.env`. Use the session pooler (5432), not the transaction pooler (6543), because Flyway/Hibernate use prepared statements.
- **Docker Desktop** only for building the backend without a JDK, or for the offline `local-db` profile.
- **NVIDIA API key** from build.nvidia.com → `NVIDIA_API_KEY` in `.env`.
- NVIDIA free-tier rate limits → cache embeddings, use fast model where possible, seed product embeddings once and store them.
- Embedding dimension is fixed in schema (1024); changing the embedding model means re-embedding.
