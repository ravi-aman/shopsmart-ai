# ShopSmart AI

AI-powered e-commerce assistant platform for the ShopSmart hackathon brief.

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + TypeScript, Tailwind CSS 4, React Router, TanStack Query |
| Backend | Java 21, Spring Boot 3.5, Spring AI 1.1 |
| Database | Supabase Postgres + pgvector (Flyway migrations) |
| AI models | NVIDIA API — Nemotron chat models, NVIDIA retrieval embeddings |

Full design and roadmap: [PLAN.md](PLAN.md).

## Layout

```
apps/backend    Spring Boot API (Maven wrapper, Dockerfile)
apps/frontend   React 19 + Vite app
infra/          docker-compose (backend container, optional offline pgvector)
PLAN.md         architecture, schema, modules, phases
```

## Setup

1. **Supabase**: create a project. In *Database → Extensions* make sure `vector` is enabled (the migration also runs `create extension if not exists vector`). Copy the **Session pooler** connection details.
2. **NVIDIA**: create an API key at build.nvidia.com.
3. **Env**: copy `.env.example` to `.env` at the repo root and fill in `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `NVIDIA_API_KEY`, `JWT_SECRET`.
4. Install:

```bash
npm install
```

```bash
npm run setup
```

## Run

Backend with a local JDK 21:

```bash
npm run dev:backend
```

Backend without a JDK (Docker):

```bash
npm run dev:backend:docker
```

Frontend (http://localhost:5173, proxies `/api` to :8080):

```bash
npm run dev:frontend
```

Both at once (needs JDK 21): `npm run dev`.

## Check it works

- http://localhost:8080/api/health — database, pgvector version, row counts
- http://localhost:8080/api/health/ai — one NVIDIA chat + embedding round-trip (requires `DEV_ENDPOINTS_ENABLED=true`)
- http://localhost:8080/swagger-ui.html — API docs
- http://localhost:5173/status — same health data in the UI

Flyway creates the schema on first backend start.

## AI shopping assistant (Module 1)

- `POST /api/ai/shopping/recommend` `{"query": "Suggest a laptop under $1000 for Java development and AI projects"}` → the brief's JSON contract (`interpretedRequirement`, `budget`, `recommendations[]`, `clarifyingQuestion`) plus score breakdown and `auditId`.
- `POST /api/ai/shopping/stream` → same pipeline as server-sent events (`step` … `result`).
- `GET /api/ai/decisions/{auditId}` → full decision trace; `POST /api/ai/decisions/{auditId}/feedback` `{"rating": 1}`.
- `POST /api/ai/admin/embed-products` (admin/ops) → embeds products missing vectors (also runs automatically on startup when `NVIDIA_API_KEY` is set).

Pipeline: NVIDIA fast model extracts intent (rule parser as fallback) → SQL hard filters + hybrid keyword/vector ranking (RRF) → deterministic spec scoring → NVIDIA agent model writes explanations, rejected if they cite numbers not in the product data → everything logged to `ai_audit_log`.

## Knowledge assistant (Module 2, RAG)

- `POST /api/ai/knowledge/ask` `{"question": "Can I return an opened laptop?", "productId": "LAP101"?}` → `{answer, confidence, sources[], followUpRequired}` plus numbered citations and `auditId`.
- `POST /api/ai/assistant/stream` `{"message": "..."}` → routes to the shopping or knowledge agent (`route` event), then streams `step`s and the `result`.
- `GET /api/ai/knowledge/chunks/{id}` → the full cited section (document, version, effective date).
- Admin (ADMIN/OPS): `GET /api/admin/documents`, `POST /api/admin/documents` (multipart: `file`, `title`, `category`, `version`, `effectiveDate`, `region`, `tiers`), `GET /api/admin/documents/{id}`, `POST /api/admin/documents/{id}/reprocess`. UI at `/admin/knowledge`.

Seed documents live in `apps/backend/src/main/resources/seed/knowledge/` (`manifest.json` holds version, effective date, category, region, tiers) and are ingested on first start through the same pipeline as uploads. PDFs are generated from `scripts/seed/pdf-src/*.md` by `scripts/seed/build-pdfs.py`.

Pipeline: parse (PDF headings/outline, Markdown headings, JSON sections) → section-aware chunks with a context header → NVIDIA embeddings (`passage`) → hybrid retrieval (full-text + pgvector, RRF, category boost, lexical rerank) over active, in-force versions → grounded answer from numbered excerpts (NVIDIA agent model; extractive quote when offline) → citations validated, numbers checked against sources → confidence computed from evidence; LOW means "not found" + `followUpRequired: true`.

## Offline database (optional)

```bash
npm run db:local
```

Then point `.env` at it: `DB_URL=jdbc:postgresql://localhost:5432/shopsmart`, user/password `shopsmart` (use `host.docker.internal` instead of `localhost` when the backend runs in Docker).
