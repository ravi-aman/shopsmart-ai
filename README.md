# ShopSmart AI

An AI-powered e-commerce platform for the ShopSmart hackathon brief. It has:

- a full storefront
- an AI shopping assistant that explains its picks (English, Hinglish and ₹ budgets)
- a RAG knowledge assistant that answers only from approved policy documents
- an order agent
- an AI checkout assistant that checks the cart against a budget
- premium fit and bundle tools
- near-expiry clearance with NGO and cold-storage partners within 3 km
- notifications, support cases and an operations console

Every AI decision is audited, with its token cost.

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, React Router, TanStack Query, Zustand |
| API | Node 22, Express 5, TypeScript, zod, JWT (jose), Vercel AI SDK, pino, nodemailer |
| Database | MongoDB 8 (Mongoose): Atlas Search (fuzzy), Atlas Vector Search, `2dsphere` + `$geoNear`, multi-document transactions |
| AI models | NVIDIA API: `nemotron-3-super` (tool-calling agents), `nemotron-3.5-lightning` (fast), `embed-qa-4` (1024-dim embeddings) |

**Docs:** [architecture](docs/architecture.md) · [demo script](docs/demo-script.md) · [RAG evaluation](docs/rag-eval-results.md) · [plan](PLAN.md). `GET /api` lists every endpoint.

## What it does (mapped to the brief)

| Requirement | Where |
|---|---|
| Catalog, categories, search, filters, sorting, pagination | `/c/:slug`, `/search`. Facets cover brand, price, rating, stock and specs. Search is typo-tolerant (Atlas Search with a `$text` fallback). |
| Comparison, wishlist, cart, preferences, auth, responsive UI | `/compare`, `/wishlist`, `/cart` (the guest cart merges on login), `/account`. Mobile has a bottom nav. |
| AI shopping assistant | `POST /api/ai/shopping/recommend`. It ranks results with hybrid keyword + vector search (RRF) and a deterministic spec scorer. Explanations are checked against the facts they cite. |
| RAG knowledge assistant | `/admin/knowledge` handles upload (PDF/MD/JSON), chunking, embeddings and versioning. `POST /api/ai/knowledge/ask` answers with confidence and citations; low-confidence answers offer a support case. |
| Orders and live tracking | `/orders/:id` has a timeline over SSE (`POST /api/orders/:id/tracking/stream`) fed by a delivery simulator. Cancel and return follow the policy. |
| Order agent | "Where is my order?" / "mera order kab aayega" go through tool calling (status, cancellation, return, policy lookup). The agent only proposes actions; the shopper confirms them. |
| AI checkout assistant | Budget check on `/cart` (`POST /api/ai/checkout/assist`). It re-quotes cheaper in-stock swaps, including fees and discounts, and never edits the cart itself. |
| Premium | Size advice from manufacturer charts, with confidence and caveats (`/api/ai/premium/fit`). "Complete the set" bundles (`/api/ai/premium/bundle`). |
| Expiry and surplus | Perishables are tracked in dated batches and sold first-expiry-first-out. An idempotent job raises tiered clearance discounts and blocks expired lots. It offers surplus to the nearest verified partner within 3 km (`$geoNear`) by email and in the partner portal (`/partner`). |
| Restock alerts and notifications | "Notify me" on out-of-stock items, sent once on restock. The header bell is live over SSE. Email goes out via SMTP when configured. |
| Support | `/support` and `/admin/support`: cases with conversation, status and priority. AI follow-ups carry the original question and the assistant's answer. |
| Operations through AI agents | The ops agent covers stock-outs, delays and promotions. Transfers and promotions are approved by a human. KPIs include AI volume, fallbacks and cost. |
| Explainable and auditable AI | "Why this?" score breakdowns, cited sections, tool-call traces and `/admin/audit`. Admin actions are written to `/api/admin/audit`. |

## Repository layout

```
apps/api         Express + TypeScript API (seed data, Dockerfile, Vitest tests)
apps/frontend    React 19 + Vite app (Dockerfile + nginx for production)
infra/           docker-compose: MongoDB Atlas Local + api + frontend
scripts/         seed builders (catalog JSON, policy PDFs) and the RAG evaluation
docs/            architecture, demo script, evaluation results
```

## Setup

1. **MongoDB**: either
   - a MongoDB Atlas cluster (Atlas Search, Vector Search and transactions included), or
   - `npm run db:local`, which runs the `mongodb/mongodb-atlas-local` image (a replica set with the same search features).
2. **NVIDIA** (optional): create an API key at build.nvidia.com. Without one, every agent runs its deterministic fallback.
3. **Environment**: copy `.env.example` to `.env` in the repo root. Set `MONGODB_URI`, a 32+ character `JWT_SECRET`, and optionally `NVIDIA_API_KEY` and `SMTP_*`.

On first start the API seeds:

- 222 products, 5 fulfilment centres with coordinates, and dated batches for perishables
- 20 NGO and cold-storage partners (some outside 3 km, some unverified)
- demo users and 11 policy documents
- 60 days of sales and two weeks of orders

It also creates the Atlas Search and Vector Search indexes and embeds products and policy chunks once a key is set.

## Run

Local development (API on :8080, web on :5173, which proxies `/api` to `VITE_BACKEND_URL`):

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev
```

The whole stack in Docker → http://localhost:3000:

```bash
docker compose -f infra/docker-compose.yml up --build
```

Demo accounts are `basic@`, `prime@`, `premium@`, `admin@`, `ops@` and `partner@shopsmart.dev`. The password comes from `DEMO_USER_PASSWORD`.

## Check it works

- `GET /api/health` reports the MongoDB version, search capabilities, transactions, counts, AI mode and email mode. The UI shows the same at `/status`.
- `GET /api/health/ai` runs one NVIDIA chat + embedding round-trip; it requires `DEV_ENDPOINTS_ENABLED=true`.
- Unit tests and typecheck:

```bash
npm test
```

```bash
npm run typecheck
```

- RAG evaluation against a running API:

```bash
node scripts/eval/rag-eval.mjs http://127.0.0.1:8080
```

## Main APIs

| Area | Endpoints |
|---|---|
| Auth & profile | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/me`, `GET/PUT /api/me/preferences`, `PUT /api/me/measurements`, `PUT /api/me/notification-preferences` |
| Catalog | `GET /api/catalog/categories`, `GET /api/catalog/products`, `GET /api/catalog/products/{idOrSlug}`, `GET /api/catalog/compare?ids=`, `GET /api/catalog/suggest?q=` |
| Cart & restock | `GET /api/cart`, `PUT/DELETE /api/cart/items/{id}`, `POST /api/cart/merge`, wishlist, `POST/DELETE /api/products/{id}/stock-requests`, `GET /api/me/stock-requests` |
| AI | `POST /api/ai/assistant/stream` (SSE router), `/api/ai/shopping/recommend`, `/api/ai/knowledge/ask`, `/api/ai/orders/ask`, `/api/ai/checkout/assist`, `/api/ai/premium/fit`, `/api/ai/premium/bundle`, `GET /api/ai/decisions/{id}`, feedback |
| Orders | `POST /api/orders/quote`, `POST /api/orders/checkout`, `GET /api/orders`, `GET /api/orders/{id}`, `POST /api/orders/{id}/tracking/stream`, `POST /api/orders/{id}/cancel`, `POST /api/orders/{id}/returns` |
| Notifications & support | `GET /api/notifications`, `POST /api/notifications/stream`, `PATCH /api/notifications/{id}/read`, `POST /api/support/cases`, `GET /api/support/cases[/{id}]`, `POST /api/support/cases/{id}/messages` |
| Partner portal | `GET /api/partner/offers`, `POST /api/partner/offers/{id}/accept`, `POST /api/partner/offers/{id}/reject`, `PATCH /api/partner/offers/{id}/status` |
| Admin / ops | documents, `GET /api/admin/orders`, `GET /api/admin/expiry/batches`, `GET/PUT /api/admin/expiry/rules`, `POST /api/admin/expiry/run`, `GET/POST/PATCH /api/admin/partners`, `GET /api/admin/partners/near`, `GET/PATCH /api/admin/support/cases`, `POST /api/admin/inventory/adjust`, `PATCH /api/admin/products/{id}`, `GET /api/ops/kpis`, `/forecast`, `/issues`, `/overstock`, `POST /api/ops/agent`, `/transfers`, `/promotions`, `GET /api/ops/audit` |

## Known limitations

- The NVIDIA-backed paths are implemented, but in this repository they were verified only through their fallbacks: structured intent extraction, grounded generation, tool-calling agents and embeddings. Run `/api/health/ai` and the RAG evaluation once a key is set.
- Payment is simulated (the brief allows this). Orders and delivery events come from the simulator.
- Background jobs run in-process. With more than one API instance, set `JOBS_ENABLED=false` on all but one. The jobs are idempotent either way.
- One fulfilment centre must hold every item in an order (no split shipments). Prices are in USD; ₹ budgets are converted at `INR_PER_USD`.
