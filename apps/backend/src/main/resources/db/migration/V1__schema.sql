-- ShopSmart AI core schema (PostgreSQL 15+ / Supabase, pgvector)

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- identity
create table users (
    id              uuid primary key default gen_random_uuid(),
    name            varchar(120) not null,
    email           varchar(255) not null unique,
    password_hash   varchar(100) not null,
    role            varchar(20)  not null default 'CUSTOMER' check (role in ('CUSTOMER', 'ADMIN', 'OPS')),
    membership_tier varchar(20)  not null default 'BASIC' check (membership_tier in ('BASIC', 'PRIME', 'PREMIUM')),
    region          varchar(40)  not null default 'IN-WEST',
    created_at      timestamptz  not null default now()
);

create table user_preferences (
    user_id               uuid primary key references users (id) on delete cascade,
    preferred_categories  text[]        not null default '{}',
    preferred_brands      text[]        not null default '{}',
    use_cases             text[]        not null default '{}',
    budget_min            numeric(12, 2),
    budget_max            numeric(12, 2),
    updated_at            timestamptz   not null default now()
);

-- ---------------------------------------------------------------- catalog
create table categories (
    id         serial primary key,
    parent_id  int references categories (id),
    slug       varchar(80)  not null unique,
    name       varchar(120) not null,
    path       varchar(400) not null,          -- e.g. electronics/computers/laptops
    sort_order int          not null default 0
);
create index idx_categories_parent on categories (parent_id);

create table brands (
    id   serial primary key,
    name varchar(120) not null unique
);

create table products (
    id           varchar(20) primary key,       -- e.g. LAP101
    name         varchar(200)   not null,
    slug         varchar(220)   not null unique,
    category_id  int            not null references categories (id),
    brand_id     int            not null references brands (id),
    description  text           not null,
    price        numeric(12, 2) not null check (price >= 0),
    mrp          numeric(12, 2) check (mrp >= 0),
    currency     varchar(3)     not null default 'USD',
    rating       numeric(2, 1)  not null default 0 check (rating between 0 and 5),
    rating_count int            not null default 0,
    images       jsonb          not null default '[]',
    specs        jsonb          not null default '{}',
    tags         text[]         not null default '{}',
    status       varchar(20)    not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
    search_tsv   tsvector generated always as (
                     setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
                     setweight(to_tsvector('english', coalesce(description, '')), 'B')) stored,
    embedding    vector(1024),
    created_at   timestamptz    not null default now(),
    updated_at   timestamptz    not null default now()
);
create index idx_products_category_price on products (category_id, price);
create index idx_products_brand on products (brand_id);
create index idx_products_search_tsv on products using gin (search_tsv);
create index idx_products_name_trgm on products using gin (name gin_trgm_ops);
create index idx_products_specs on products using gin (specs);
create index idx_products_tags on products using gin (tags);
create index idx_products_embedding on products using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------- inventory
create table warehouses (
    id     varchar(20) primary key,              -- e.g. WH-MUM
    name   varchar(120) not null,
    city   varchar(80)  not null,
    region varchar(40)  not null
);

create table inventory (
    product_id    varchar(20) not null references products (id) on delete cascade,
    warehouse_id  varchar(20) not null references warehouses (id),
    on_hand       int         not null default 0 check (on_hand >= 0),
    reserved      int         not null default 0 check (reserved >= 0),
    reorder_point int         not null default 5,
    updated_at    timestamptz not null default now(),
    primary key (product_id, warehouse_id)
);

create table stock_movements (
    id           bigserial primary key,
    product_id   varchar(20) not null references products (id) on delete cascade,
    warehouse_id varchar(20) not null references warehouses (id),
    delta        int         not null,
    reason       varchar(30) not null check (reason in ('SALE', 'RESTOCK', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT')),
    created_at   timestamptz not null default now()
);
create index idx_stock_movements_product_time on stock_movements (product_id, created_at);

-- ---------------------------------------------------------------- shopping
create table carts (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid unique references users (id) on delete cascade,
    guest_token varchar(64) unique,
    updated_at  timestamptz not null default now(),
    check (user_id is not null or guest_token is not null)
);

create table cart_items (
    cart_id        uuid           not null references carts (id) on delete cascade,
    product_id     varchar(20)    not null references products (id),
    quantity       int            not null check (quantity between 1 and 20),
    price_snapshot numeric(12, 2) not null,
    added_at       timestamptz    not null default now(),
    primary key (cart_id, product_id)
);

create table wishlists (
    user_id    uuid        not null references users (id) on delete cascade,
    product_id varchar(20) not null references products (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, product_id)
);

create table orders (
    id               varchar(20) primary key,     -- e.g. ORD-100045
    user_id          uuid           not null references users (id),
    status           varchar(30)    not null default 'PLACED' check (status in (
                         'PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED',
                         'CANCELLED', 'RETURN_REQUESTED', 'RETURNED', 'REFUNDED')),
    subtotal         numeric(12, 2) not null,
    shipping_fee     numeric(12, 2) not null default 0,
    discount         numeric(12, 2) not null default 0,
    total            numeric(12, 2) not null,
    currency         varchar(3)     not null default 'USD',
    shipping_address jsonb          not null,
    warehouse_id     varchar(20)    references warehouses (id),
    promised_date    date,
    created_at       timestamptz    not null default now(),
    updated_at       timestamptz    not null default now()
);
create index idx_orders_user on orders (user_id, created_at desc);
create index idx_orders_status on orders (status);

create table order_items (
    order_id   varchar(20)    not null references orders (id) on delete cascade,
    product_id varchar(20)    not null references products (id),
    quantity   int            not null check (quantity > 0),
    unit_price numeric(12, 2) not null,
    primary key (order_id, product_id)
);

create table shipments (
    id          varchar(20) primary key,
    order_id    varchar(20) not null unique references orders (id) on delete cascade,
    carrier     varchar(60) not null,
    tracking_no varchar(60) not null,
    eta         date,
    delayed     boolean     not null default false
);

create table shipment_events (
    id          bigserial primary key,
    shipment_id varchar(20)  not null references shipments (id) on delete cascade,
    status      varchar(30)  not null,
    location    varchar(120),
    note        varchar(300),
    occurred_at timestamptz  not null default now()
);
create index idx_shipment_events_shipment on shipment_events (shipment_id, occurred_at);

create table return_requests (
    id               uuid primary key default gen_random_uuid(),
    order_id         varchar(20)  not null references orders (id),
    product_id       varchar(20)  not null references products (id),
    reason           varchar(500) not null,
    status           varchar(20)  not null default 'REQUESTED' check (status in ('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED')),
    policy_reference jsonb,                    -- cited policy chunk(s) that justified the decision
    created_at       timestamptz  not null default now()
);

create table promotions (
    id          uuid primary key default gen_random_uuid(),
    code        varchar(40)    not null unique,
    description varchar(300)   not null,
    type        varchar(20)    not null check (type in ('PERCENT', 'FLAT')),
    value       numeric(12, 2) not null check (value > 0),
    category_id int            references categories (id),
    product_id  varchar(20)    references products (id),
    starts_at   timestamptz    not null,
    ends_at     timestamptz    not null,
    status      varchar(20)    not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'ENDED')),
    created_by  varchar(10)    not null default 'HUMAN' check (created_by in ('HUMAN', 'AGENT')),
    rationale   text,
    created_at  timestamptz    not null default now(),
    check (ends_at > starts_at)
);

-- ---------------------------------------------------------------- knowledge (RAG)
create table documents (
    id               uuid primary key default gen_random_uuid(),
    title            varchar(200) not null,
    category         varchar(20)  not null check (category in (
                         'RETURN', 'SHIPPING', 'REFUND', 'WARRANTY', 'MEMBERSHIP', 'MANUAL', 'SELLER', 'SLA', 'CANCELLATION')),
    region           varchar(40)  not null default 'GLOBAL',
    version          varchar(20)  not null,
    effective_date   date         not null,
    applies_to_tiers text[]       not null default '{BASIC,PRIME,PREMIUM}',
    source_type      varchar(10)  not null check (source_type in ('PDF', 'MARKDOWN', 'JSON')),
    file_name        varchar(255) not null,
    storage_path     varchar(500) not null,
    checksum         varchar(64)  not null unique,
    status           varchar(20)  not null default 'UPLOADED' check (status in ('UPLOADED', 'PROCESSING', 'READY', 'FAILED')),
    error_message    text,
    chunk_count      int          not null default 0,
    is_active        boolean      not null default true,
    uploaded_by      uuid         references users (id),
    created_at       timestamptz  not null default now(),
    unique (title, version)
);
create index idx_documents_active on documents (category, region) where is_active;

-- Table used by Spring AI PgVectorStore (initialize-schema=false), plus a keyword index for hybrid search.
create table vector_store (
    id          uuid primary key default gen_random_uuid(),
    content     text,
    metadata    json,
    embedding   vector(1024),
    content_tsv tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored
);
create index idx_vector_store_embedding on vector_store using hnsw (embedding vector_cosine_ops);
create index idx_vector_store_tsv on vector_store using gin (content_tsv);
create index idx_vector_store_document on vector_store ((metadata ->> 'documentId'));

-- ---------------------------------------------------------------- AI audit
create table ai_audit_log (
    id                  uuid primary key default gen_random_uuid(),
    conversation_id     varchar(64),
    user_id             uuid references users (id),
    agent               varchar(30)  not null,   -- ORCHESTRATOR, SHOPPING, KNOWLEDGE, ORDER, OPS
    intent              varchar(60),
    input               text         not null,
    extracted_params    jsonb,
    tool_calls          jsonb        not null default '[]',
    retrieved_chunk_ids text[]       not null default '{}',
    retrieval_scores    real[]       not null default '{}',
    output              jsonb,
    confidence          varchar(10)  check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
    model               varchar(120),
    prompt_tokens       int,
    completion_tokens   int,
    latency_ms          int,
    human_approved      boolean,
    error               text,
    created_at          timestamptz  not null default now()
);
create index idx_ai_audit_created on ai_audit_log (created_at desc);
create index idx_ai_audit_agent on ai_audit_log (agent, created_at desc);

create table ai_feedback (
    audit_id   uuid        not null references ai_audit_log (id) on delete cascade,
    user_id    uuid        not null references users (id) on delete cascade,
    rating     smallint    not null check (rating in (-1, 1)),
    comment    varchar(500),
    created_at timestamptz not null default now(),
    primary key (audit_id, user_id)
);
