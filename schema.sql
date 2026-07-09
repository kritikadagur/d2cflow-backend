-- ============================================================
-- D2C Automation Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;

-- ============================================================
-- Tenants (one row per registered brand / SaaS customer)
-- ============================================================
create table if not exists tenants (
    id              uuid primary key,  -- = auth.users.id
    brand_name      text not null,
    phone           text,
    gstin           text,
    pickup_address  jsonb,
    plan            text default 'free',  -- free/starter/growth/pro
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

-- Auto-create tenant row on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.tenants (id, brand_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'brand_name', new.email),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- Channel Credentials (OAuth tokens & API keys per tenant)
-- ============================================================
create table if not exists channel_credentials (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    channel         text not null,  -- shopify/amazon/flipkart/meesho/myntra/shiprocket/whatsapp/meta
    credentials     text,           -- JSON-encoded, encrypted via Supabase Vault in prod
    connected       boolean default false,
    display_name    text,
    connected_at    timestamptz default now(),
    updated_at      timestamptz default now(),
    unique(tenant_id, channel)
);

-- RLS: tenants can only see their own credentials
alter table channel_credentials enable row level security;
create policy "tenant_own" on channel_credentials
  for all using (tenant_id = auth.uid());

alter table tenants enable row level security;
create policy "tenant_own" on tenants
  for all using (id = auth.uid());

-- ============================================================
-- SKU Master
-- ============================================================
create table if not exists skus (
    id              uuid primary key default uuid_generate_v4(),
    sku             text unique not null,
    name            text not null,
    category        text,
    brand           text,
    hsn_code        text,
    cost_price      numeric(10,2) not null default 0,
    mrp             numeric(10,2) not null default 0,
    weight_grams    int not null default 0,  -- dead weight for courier calc
    length_cm       numeric(6,2),
    breadth_cm      numeric(6,2),
    height_cm       numeric(6,2),
    reorder_qty     int not null default 50,
    supplier_name   text,
    supplier_contact text,
    lead_time_days  int default 7,
    is_active       boolean default true,
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

-- ============================================================
-- Channel Listings (one row per SKU per channel)
-- ============================================================
create table if not exists listings (
    id              uuid primary key default uuid_generate_v4(),
    sku             text not null references skus(sku),
    channel         text not null,  -- amazon/flipkart/meesho/myntra/shopify
    channel_sku_id  text not null,  -- ASIN, FSN, etc.
    listing_id      text,
    title           text,
    price           numeric(10,2),
    mrp             numeric(10,2),
    is_active       boolean default true,
    last_synced_at  timestamptz,
    created_at      timestamptz default now(),
    unique(channel, channel_sku_id)
);

-- ============================================================
-- Inventory
-- ============================================================
create table if not exists inventory (
    id              uuid primary key default uuid_generate_v4(),
    sku             text unique not null references skus(sku),
    qty_on_hand     int not null default 0,
    qty_reserved    int not null default 0,  -- pending unfulfilled orders
    qty_available   int generated always as (qty_on_hand - qty_reserved) stored,
    last_synced_at  timestamptz default now(),
    updated_at      timestamptz default now()
);

-- ============================================================
-- Orders
-- ============================================================
create table if not exists orders (
    id                  uuid primary key default uuid_generate_v4(),
    channel             text not null,
    channel_order_id    text not null,
    channel_suborder_id text,
    status              text not null default 'pending',
    -- pending / confirmed / rtd / dispatched / delivered / cancelled / returned / rto
    payment_mode        text,  -- prepaid / cod
    cod_confirmed       boolean,
    cod_confirmed_at    timestamptz,
    customer_name       text,
    customer_phone      text,
    customer_email      text,
    shipping_address    jsonb,
    pincode             text,
    state               text,
    courier             text,
    awb                 text,
    shiprocket_order_id text,
    label_url           text,
    pickup_scheduled_at timestamptz,
    dispatched_at       timestamptz,
    delivered_at        timestamptz,
    return_initiated_at timestamptz,
    rto_flag            boolean default false,
    rto_risk_score      numeric(4,2),  -- 0-1
    total_amount        numeric(10,2),
    marketplace_fee     numeric(10,2),
    shipping_charge     numeric(10,2),
    raw_payload         jsonb,
    created_at          timestamptz default now(),
    updated_at          timestamptz default now(),
    unique(channel, channel_order_id)
);

-- ============================================================
-- Order Line Items
-- ============================================================
create table if not exists order_items (
    id              uuid primary key default uuid_generate_v4(),
    order_id        uuid not null references orders(id) on delete cascade,
    sku             text references skus(sku),
    channel_sku_id  text,
    name            text,
    qty             int not null default 1,
    unit_price      numeric(10,2),
    cost_price      numeric(10,2),
    created_at      timestamptz default now()
);

-- ============================================================
-- Purchase Orders
-- ============================================================
create table if not exists purchase_orders (
    id              uuid primary key default uuid_generate_v4(),
    po_number       text unique not null,
    sku             text not null references skus(sku),
    supplier_name   text,
    qty_ordered     int not null,
    unit_cost       numeric(10,2),
    status          text default 'draft',  -- draft/sent/acknowledged/received/cancelled
    expected_by     date,
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

-- ============================================================
-- Couriers & Rate Card
-- ============================================================
create table if not exists courier_zones (
    id          uuid primary key default uuid_generate_v4(),
    courier     text not null,  -- delhivery/bluedart/ecomexpress/dtdc
    zone        text not null,  -- A/B/C/D/E
    pincode_from text,
    pincode_to   text,
    base_weight_grams int default 500,
    base_rate   numeric(8,2),
    per_500g    numeric(8,2),
    cod_charge  numeric(8,2),
    unique(courier, zone)
);

-- ============================================================
-- Shiprocket token cache
-- ============================================================
create table if not exists shiprocket_tokens (
    id          uuid primary key default uuid_generate_v4(),
    token       text not null,
    expires_at  timestamptz not null,
    created_at  timestamptz default now()
);

-- ============================================================
-- NDR (Non-Delivery Report)
-- ============================================================
create table if not exists ndrs (
    id              uuid primary key default uuid_generate_v4(),
    order_id        uuid references orders(id),
    awb             text,
    reason          text,
    action_taken    text,  -- reattempt/rto/customer_contacted
    created_at      timestamptz default now()
);

-- ============================================================
-- Returns & Claims
-- ============================================================
create table if not exists returns (
    id              uuid primary key default uuid_generate_v4(),
    order_id        uuid references orders(id),
    channel         text,
    return_reason   text,
    return_status   text default 'initiated',  -- initiated/in_transit/received/refunded
    claim_filed     boolean default false,
    claim_status    text,
    claim_amount    numeric(10,2),
    created_at      timestamptz default now()
);

-- ============================================================
-- Automation Event Log
-- ============================================================
create table if not exists automation_logs (
    id          uuid primary key default uuid_generate_v4(),
    event_type  text not null,
    entity_type text,  -- order/sku/listing
    entity_id   text,
    status      text,  -- success/failed/skipped
    message     text,
    payload     jsonb,
    created_at  timestamptz default now()
);

-- ============================================================
-- Notification Log (deduplicate WA/email)
-- ============================================================
create table if not exists notification_log (
    id          uuid primary key default uuid_generate_v4(),
    channel     text not null,  -- whatsapp/email
    recipient   text not null,
    template    text not null,
    entity_id   text,
    sent_at     timestamptz default now()
);

-- ============================================================
-- App Settings (key-value store for runtime config)
-- ============================================================
create table if not exists app_settings (
    key     text primary key,
    value   text,
    updated_at timestamptz default now()
);

-- ============================================================
-- Indexes for query performance
-- ============================================================
create index if not exists idx_orders_channel_status on orders(channel, status);
create index if not exists idx_orders_pincode on orders(pincode);
create index if not exists idx_orders_created_at on orders(created_at desc);
create index if not exists idx_order_items_sku on order_items(sku);
create index if not exists idx_automation_logs_created on automation_logs(created_at desc);
create index if not exists idx_listings_channel_sku on listings(channel, sku);

-- ============================================================
-- RTO Risk View (pincode-level RTO rate)
-- ============================================================
create or replace view rto_hotspots as
select
    pincode,
    state,
    count(*) filter (where status = 'rto') as rto_count,
    count(*) as total_orders,
    round(count(*) filter (where status = 'rto')::numeric / nullif(count(*), 0) * 100, 2) as rto_rate_pct
from orders
where created_at > now() - interval '90 days'
group by pincode, state
order by rto_rate_pct desc;

-- ============================================================
-- Profit per SKU View
-- ============================================================
create or replace view profit_per_sku as
select
    oi.sku,
    s.name,
    count(distinct o.id) as total_orders,
    sum(oi.qty) as units_sold,
    sum(oi.unit_price * oi.qty) as gross_revenue,
    sum(oi.cost_price * oi.qty) as total_cogs,
    sum(o.marketplace_fee) as total_marketplace_fees,
    sum(o.shipping_charge) as total_shipping,
    sum(
        (oi.unit_price * oi.qty)
        - (oi.cost_price * oi.qty)
        - o.marketplace_fee
        - o.shipping_charge
    ) as estimated_profit
from order_items oi
join orders o on oi.order_id = o.id
join skus s on oi.sku = s.sku
where o.status not in ('cancelled', 'rto')
group by oi.sku, s.name;

-- ============================================================
-- Daily Summary View
-- ============================================================
create or replace view daily_summary as
select
    date_trunc('day', created_at)::date as date,
    channel,
    count(*) as total_orders,
    count(*) filter (where payment_mode = 'cod') as cod_orders,
    count(*) filter (where payment_mode = 'prepaid') as prepaid_orders,
    count(*) filter (where status = 'delivered') as delivered,
    count(*) filter (where status = 'rto') as rto,
    count(*) filter (where status = 'returned') as returned,
    sum(total_amount) as gmv,
    round(count(*) filter (where status = 'dispatched' or status = 'delivered')::numeric
          / nullif(count(*),0) * 100, 2) as fulfillment_rate_pct
from orders
group by 1, 2
order by 1 desc, 2;

-- ============================================================
-- Phase 2 additions — safe to run on existing DB
-- All ALTER TABLEs use IF NOT EXISTS / idempotent
-- ============================================================

-- ── Orders: payment + warehouse + source columns ──────────────
alter table orders add column if not exists payment_status  text default 'pending';
alter table orders add column if not exists payment_id      text;
alter table orders add column if not exists amount_paid     numeric(10,2);
alter table orders add column if not exists paid_at         timestamptz;
alter table orders add column if not exists warehouse_id    uuid;
alter table orders add column if not exists source          text default 'marketplace';
alter table orders add column if not exists chat_jid        text;
alter table orders add column if not exists payment_link    text;
alter table orders add column if not exists payment_link_id text;

-- ── SKUs: extended columns from catalog importers ─────────────
alter table skus add column if not exists selling_price            numeric(10,2);
alter table skus add column if not exists product_id               uuid;
-- Ensure the FK exists so PostgREST can embed products→skus→inventory.
-- Bare `references products(id)` in the ADD COLUMN above is skipped when the
-- column already exists on older DBs, so we add the constraint explicitly.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'skus_product_id_fkey'
  ) then
    alter table skus
      add constraint skus_product_id_fkey
      foreign key (product_id) references products(id) on delete set null;
  end if;
end $$;
alter table skus add column if not exists barcode                  text;
alter table skus add column if not exists color                    text;
alter table skus add column if not exists size                     text;
alter table skus add column if not exists shopify_variant_id       text;
alter table skus add column if not exists shopify_inventory_item_id text;
alter table skus add column if not exists amazon_asin              text;
alter table skus add column if not exists flipkart_fsn             text;
alter table skus add column if not exists zoho_item_id             text;

-- ── Listings: pricing + deactivation columns ──────────────────
alter table listings add column if not exists channel_price              numeric(10,2);
alter table listings add column if not exists channel_mrp                numeric(10,2);
alter table listings add column if not exists is_deactivated_by_channel  boolean default false;
alter table listings drop constraint if exists listings_channel_sku_id_key;
alter table listings add column if not exists sku_col text;

-- Fix listings unique constraint to (sku, channel) instead of (channel, channel_sku_id)
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_sku_channel_key'
  ) then
    alter table listings add constraint listings_sku_channel_key unique (sku, channel);
  end if;
end $$;

-- ============================================================
-- Products / PIM
-- ============================================================
create table if not exists products (
    id                  uuid primary key default uuid_generate_v4(),
    tenant_id           uuid references tenants(id) on delete cascade,
    shopify_product_id  text,
    name                text not null,
    description         text,
    brand               text,
    category            text,
    sub_category        text,
    hsn_code            text,
    gst_rate            numeric(5,2),
    images              text[] default '{}',
    tags                text[] default '{}',
    is_active           boolean default true,
    created_at          timestamptz default now(),
    updated_at          timestamptz default now()
);

create index if not exists idx_products_tenant    on products(tenant_id);
create index if not exists idx_products_shopify   on products(shopify_product_id);
create index if not exists idx_skus_product_id    on skus(product_id);

-- ============================================================
-- Contacts (uploaded CSV + WhatsApp verification)
-- ============================================================
create table if not exists contacts (
    id                  uuid primary key default uuid_generate_v4(),
    tenant_id           uuid references tenants(id) on delete cascade,
    name                text not null,
    phone               text,
    phone_e164          text,
    email               text,
    business_name       text,
    tags                text[] default '{}',
    source              text default 'manual',
    is_on_whatsapp      boolean,
    whatsapp_jid        text,
    wa_checked_at       timestamptz,
    last_messaged_at    timestamptz,
    notes               text,
    created_at          timestamptz default now(),
    updated_at          timestamptz default now(),
    unique (tenant_id, phone_e164)
);

create index if not exists idx_contacts_tenant    on contacts(tenant_id);
create index if not exists idx_contacts_wa_jid    on contacts(whatsapp_jid);

-- ============================================================
-- Contact Lists (named broadcast groups)
-- ============================================================
create table if not exists contact_lists (
    id          uuid primary key default uuid_generate_v4(),
    tenant_id   uuid references tenants(id) on delete cascade,
    name        text not null,
    created_at  timestamptz default now()
);

create table if not exists contact_list_members (
    id          uuid primary key default uuid_generate_v4(),
    list_id     uuid not null references contact_lists(id) on delete cascade,
    contact_id  uuid not null references contacts(id) on delete cascade,
    added_at    timestamptz default now(),
    unique (list_id, contact_id)
);

-- ============================================================
-- Warehouses
-- ============================================================
create table if not exists warehouses (
    id                  uuid primary key default uuid_generate_v4(),
    tenant_id           uuid references tenants(id) on delete cascade,
    name                text not null,
    code                text not null,
    address             text,
    city                text,
    state               text,
    pincode             text,
    channels            text[] default '{}',
    pickup_slot_rules   jsonb default '{}',
    weight_rules        jsonb default '{}',
    is_active           boolean default true,
    created_at          timestamptz default now(),
    updated_at          timestamptz default now()
);

create table if not exists warehouse_routing_rules (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid references tenants(id) on delete cascade,
    warehouse_id    uuid references warehouses(id) on delete cascade,
    rule_type       text not null,
    rule_value      text not null,
    priority        int default 0,
    created_at      timestamptz default now()
);

-- ============================================================
-- Repricing
-- ============================================================
create table if not exists repricing_rules (
    id          uuid primary key default uuid_generate_v4(),
    sku         text not null references skus(sku) on delete cascade,
    channel     text,
    strategy    text not null default 'beat_by_pct',
    beat_by_pct numeric(5,2) default 1.0,
    markup_pct  numeric(5,2) default 20.0,
    min_price   numeric(10,2),
    max_price   numeric(10,2),
    is_active   boolean default true,
    created_at  timestamptz default now(),
    unique (sku, channel)
);

create table if not exists repricing_history (
    id                  uuid primary key default uuid_generate_v4(),
    sku                 text not null,
    channel             text,
    old_price           numeric(10,2),
    new_price           numeric(10,2),
    competitor_min      numeric(10,2),
    strategy            text,
    rule_id             uuid,
    created_at          timestamptz default now()
);

create table if not exists competitor_prices (
    id                      uuid primary key default uuid_generate_v4(),
    sku                     text not null references skus(sku) on delete cascade,
    channel                 text not null,
    min_competitor_price    numeric(10,2),
    max_competitor_price    numeric(10,2),
    our_price               numeric(10,2),
    fetched_at              timestamptz default now(),
    unique (sku, channel)
);

-- ============================================================
-- COD Blocked Zones
-- ============================================================
create table if not exists cod_blocked_zones (
    id              uuid primary key default uuid_generate_v4(),
    pincode         text not null unique,
    state           text,
    reason          text,
    rto_rate_pct    numeric(5,2),
    is_active       boolean default true,
    blocked_at      timestamptz default now(),
    unblocked_at    timestamptz
);

-- ============================================================
-- Instagram / WhatsApp purchase-intent signals
-- ============================================================
create table if not exists instagram_cues (
    id              uuid primary key default uuid_generate_v4(),
    channel         text not null,  -- whatsapp | instagram_comment | instagram_dm
    sender_id       text not null,
    sender_name     text,
    message_text    text,
    message_id      text unique,
    media_id        text,
    status          text default 'pending',  -- pending | replied | ignored
    reply_text      text,
    replied_at      timestamptz,
    created_at      timestamptz default now()
);
create index if not exists idx_instagram_cues_status on instagram_cues(status);

-- ============================================================
-- Manifests
-- ============================================================
create table if not exists manifests (
    id              uuid primary key default uuid_generate_v4(),
    manifest_id     text unique not null,
    warehouse_id    uuid references warehouses(id),
    courier         text,
    order_count     int default 0,
    status          text default 'generated',
    generated_at    timestamptz default now()
);
