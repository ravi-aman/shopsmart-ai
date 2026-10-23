# Demo script (about 7 minutes)

Demo accounts (password = `DEMO_USER_PASSWORD`, default in `.env.example`): `basic@`, `prime@`, `premium@`, `admin@`, `ops@shopsmart.dev`.

## 1. Storefront (1 min) — signed in as prime@shopsmart.dev
1. Search `lenvo thinkpad` → typo-tolerant search finds the ThinkPad.
2. Open **Laptops**, filter RAM = 16 GB and price ≤ $1000, sort by price. Note the URL keeps every filter.
3. Tick **Compare** on Dell Inspiron 15, ASUS TUF A15 and MacBook Air M3 → **Compare now** → toggle *Show only differences*; best values are highlighted.

## 2. AI shopping assistant — Module 1 (1.5 min)
1. Click **Ask ShopSmart AI** → *Suggest a laptop under $1000 for Java development and AI projects*.
2. Point out the live steps, the *I understood* chips (budget, use cases) and the three picks.
3. Open **Why this?** on Dell Inspiron 15 → reason `16GB RAM, Intel i7 processor, SSD storage`, the score breakdown and the "integrated graphics" trade-off.
4. Ask *something nice for my mom* → the assistant asks a clarifying question instead of guessing.
5. `POST /api/ai/shopping/recommend` in Swagger shows the brief's exact JSON contract.

## 3. Knowledge assistant — Module 2 (1.5 min)
1. Ask the five brief questions: opened laptop return, refund timeline, Prime free delivery, cancel after shipment, and (from a phone's product page → *What is the warranty on this smartphone?*).
2. Click a citation number → the exact section, version and effective date open.
3. Ask *Can I pay with bitcoin?* → "not found", flagged for support, nothing invented.

## 4. Orders and the order agent (1.5 min)
1. Add the Dell Inspiron 15 to the cart → **Checkout** → delivery is free for Prime (cited Shipping Policy section) with a promised date → **Place order**.
2. In the assistant: *Can I cancel my order?* → allowed (Before Shipment), confirm card.
3. As admin, **Console → Orders → Advance** twice (now Shipped). Ask again → not allowed, cites *After Shipment*.
4. Advance to Delivered → *I want to return it* → returnable until a date under *Laptop Return Policy › Opened Products* → confirm the pickup.

## 5. Operations console (1.5 min) — admin@shopsmart.dev
1. **Overview**: KPIs, 14-day orders chart, AI usage by agent.
2. Ops agent → *Which products will stock out this week?* → summary plus transfer cards → **Approve transfer**.
3. **Inventory**: days-of-cover table; promotions for slow sellers → create draft → **Activate**. The product page now shows the deal and checkout applies it.
4. **Knowledge base**: upload a new version of the Shipping Policy (e.g. Basic free-delivery threshold changed) → status goes PROCESSING → READY, the old version becomes *superseded*, and the assistant immediately answers with the new version.
5. **AI audit log**: open any decision to show input, tool calls, retrieved sections, model, latency and whether a fallback was used.

## 6. Quality evidence (30 s)
- `node scripts/eval/rag-eval.mjs` → results in `docs/rag-eval-results.md`.
- Backend unit tests: parser, scorer, grounding checks, retrieval ranking, PDF/Markdown parsing.
