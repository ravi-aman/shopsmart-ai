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

## Offline database (optional)

```bash
npm run db:local
```

Then point `.env` at it: `DB_URL=jdbc:postgresql://localhost:5432/shopsmart`, user/password `shopsmart` (use `host.docker.internal` instead of `localhost` when the backend runs in Docker).
