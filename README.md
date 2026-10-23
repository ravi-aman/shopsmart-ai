# ShopSmart AI

An AI-powered e-commerce platform for the ShopSmart hackathon brief: a full storefront, an AI shopping assistant that explains its picks, a RAG knowledge assistant that answers only from approved policy documents, an order agent, and an operations console — with every AI decision auditable.

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, React Router, TanStack Query, Zustand |
| Backend | Java 21, Spring Boot 3.5, Spring AI 1.1 (ChatClient, structured output, `@Tool` calling), Spring Security (JWT), Flyway |
| Database | Supabase Postgres + pgvector (HNSW), Postgres full-text + trigram search |
| AI models | NVIDIA API — `nemotron-3-super` (agent), `nemotron-3.5-lightning` (fast), `embed-qa-4` (retrieval embeddings) |

**Docs:** [architecture & diagrams](docs/architecture.md) · [demo script](docs/demo-script.md) · [RAG evaluation results](docs/rag-eval-results.md) · [implementation plan](PLAN.md) · API docs at `/swagger-ui.html`

## What it does (mapped to the brief)

| Brief requirement | Where |
|---|---|
| Catalog, category hierarchy, search, filtering, sorting, pagination | `/c/:slug`, `/search` — facets for brand, price, rating, stock and specs; typo-tolerant search |
| Product comparison, wishlist, cart, customer preferences, login, responsive UI | `/compare`, `/wishlist`, `/cart` (guest cart merges on login), `/account`, mobile bottom nav |
| AI shopping assistant: intent → requirements → recommendations → explanations | `POST /api/ai/shopping/recommend` returns `{interpretedRequirement, budget, recommendations[{productId, productName, reason, availability}], clarifyingQuestion}` |
| RAG: upload, PDF/Markdown/JSON ingestion, chunking, embeddings, vector search, grounded answers | `/admin/knowledge`, `POST /api/ai/knowledge/ask` returns `{answer, confidence, sources[{document, section, version}], followUpRequired}` |
| Order tracking and shipment status | `/orders/:id` timeline, delivery simulator, order agent ("Where is my order?") |
| Coordinating operations through AI agents | ops agent (stock-outs, delays, promotions) with human-approved transfers and promotions |
| Explainable and auditable AI | "Why this?" score breakdown, cited sections, tool lists, `/admin/audit` with full decision traces |
| Membership tiers, warehouses, versioned documents | Basic/Prime/Premium affect delivery fees and answers; 5 fulfilment centres; one active version per document |

## Repository layout

```
apps/backend     Spring Boot API (Maven wrapper, Dockerfile, Flyway migrations, seed data)
apps/frontend    React 19 + Vite app (Dockerfile + nginx for production)
infra/           docker-compose for the whole stack (+ optional offline pgvector)
scripts/         seed builders (catalog JSON, policy PDFs) and the RAG evaluation
docs/            architecture, demo script, evaluation results
```

## Setup

1. **Supabase** — create a project; in *Database → Extensions* enable `vector` (the migration also runs `create extension if not exists vector`). From *Connect*, copy the **Session pooler** connection (port 5432 — not the transaction pooler, Flyway needs session mode).
2. **NVIDIA** — create an API key at build.nvidia.com.
3. **Environment** — copy `.env.example` to `.env` in the repo root and fill in `DB_URL` (JDBC form), `DB_USERNAME` (`postgres.<project-ref>`), `DB_PASSWORD`, `NVIDIA_API_KEY` and a 32+ character `JWT_SECRET`.

On first start the backend creates the schema and seeds 222 products, 5 fulfilment centres, demo users, 11 policy documents (PDF/MD/JSON, including a superseded version), 60 days of sales history and two weeks of orders. With an NVIDIA key it also embeds products and policy chunks.

## Run

Whole stack in Docker (no local JDK needed) → http://localhost:3000 (set `FRONTEND_PORT` to change):

```bash
docker compose -f infra/docker-compose.yml up --build
```

Local development (backend needs JDK 21):

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev
```

Or run the pieces separately: `npm run dev:backend` (or `npm run dev:backend:docker`) and `npm run dev:frontend` (http://localhost:5173, proxies `/api` to `127.0.0.1:8080`).

Offline database instead of Supabase: `npm run db:local`, then point `.env` at `jdbc:postgresql://localhost:5432/shopsmart` with user/password `shopsmart` (use `host.docker.internal` or `postgres` as the host when the backend runs in Docker).

Demo accounts: `basic@`, `prime@`, `premium@`, `admin@`, `ops@shopsmart.dev` — password from `DEMO_USER_PASSWORD`.

## Check it works

- `GET /api/health` — database, pgvector, product and chunk counts (also at `/status` in the UI)
- `GET /api/health/ai` — one NVIDIA chat + embedding round-trip; requires `DEV_ENDPOINTS_ENABLED=true`
- RAG evaluation against a running backend:

```bash
node scripts/eval/rag-eval.mjs http://127.0.0.1:8080
```

- Backend unit tests (Docker, no JDK needed):

```bash
docker run --rm -v "$PWD/apps/backend:/app" -w /app maven:3.9-eclipse-temurin-21 mvn -q test
```

## Main APIs

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/me`, `GET/PUT /api/me/preferences` |
| Catalog | `GET /api/catalog/categories`, `GET /api/catalog/products` (q, category, brand, minPrice, maxPrice, minRating, inStock, `spec.<key>`, sort, page, size), `GET /api/catalog/products/{idOrSlug}`, `GET /api/catalog/compare?ids=`, `GET /api/catalog/suggest?q=` |
| Cart | `GET /api/cart`, `PUT/DELETE /api/cart/items/{productId}`, `POST /api/cart/merge`, `GET/PUT/DELETE /api/wishlist/...` |
| Assistant | `POST /api/ai/assistant/stream` (routes to shopping / knowledge / order agent, SSE), `POST /api/ai/shopping/recommend`, `POST /api/ai/knowledge/ask`, `GET /api/ai/knowledge/chunks/{id}`, `GET /api/ai/decisions/{id}`, `POST /api/ai/decisions/{id}/feedback` |
| Orders | `POST /api/orders/quote`, `POST /api/orders/checkout`, `GET /api/orders`, `GET /api/orders/{id}`, `POST /api/orders/{id}/cancel`, `POST /api/orders/{id}/returns` |
| Admin / ops | `GET/POST /api/admin/documents`, `POST /api/admin/documents/{id}/reprocess`, `GET /api/admin/orders`, `POST /api/admin/orders/{id}/advance`, `GET /api/ops/kpis`, `GET /api/ops/forecast`, `GET /api/ops/issues`, `POST /api/ops/agent`, `POST /api/ops/transfers`, `GET/POST /api/ops/promotions`, `GET /api/ops/audit` |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` | — | Supabase (or local) Postgres |
| `NVIDIA_API_KEY` | — | Without it every agent runs its deterministic fallback |
| `NVIDIA_AGENT_MODEL`, `NVIDIA_FAST_MODEL`, `NVIDIA_EMBEDDING_MODEL` | see `.env.example` | Any model from build.nvidia.com |
| `EMBEDDING_DIMENSIONS`, `EMBEDDING_SEND_DIMENSIONS` | `1024`, `false` | Must match `vector(1024)` in the schema |
| `JWT_SECRET`, `JWT_TTL_MINUTES` | —, `720` | Token signing |
| `DEMO_USER_PASSWORD` | `ShopSmart@2026` | Seeded demo accounts |
| `AI_RATE_LIMIT_PER_MINUTE` | `15` | Per user/IP limit on AI endpoints |
| `SIMULATOR_ENABLED`, `SIMULATOR_STEP_SECONDS` | `true`, `180` | Mock carrier speed |
| `KNOWLEDGE_STORAGE_DIR` | `storage/knowledge` | Where uploaded files are kept |
| `DEV_ENDPOINTS_ENABLED` | `false` | Enables `/api/health/ai` |

## Known limitations

- The NVIDIA-backed paths (structured intent extraction, grounded generation, tool-calling agents, embeddings) are implemented but were verified in this repository only through their fallbacks; run `/api/health/ai` and the RAG evaluation once a key is set.
- Payment is out of scope (as the brief allows); orders and delivery events are simulated.
- Uploaded documents are stored on the backend's disk (a Docker volume in compose); use a persistent volume or object storage in production.
- One fulfilment centre must hold every item in an order (no split shipments).
