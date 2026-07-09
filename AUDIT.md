# Supabase Query Audit — backend/ vs schema.sql

Audited every Supabase query (`db.table(...)`) in `backend/routers/*.py`, `backend/couriers/*.py`,
`backend/automation/*.py`, `backend/catalog/*.py`, `backend/notifications/*.py`,
`backend/database.py`, `backend/scheduler.py`, `backend/main.py`, `backend/wa_scanner.py`,
plus incidentally-touched files (`backend/ingestion/base.py`, `backend/listings/engine.py`,
`backend/accounting/zoho.py`) that share the same schema.

Schema map built from `schema.sql` (lines 1–577), including the Phase 2 `ALTER TABLE` blocks
(lines 356–393) that added:

- `orders`: `payment_status, payment_id, amount_paid, paid_at, warehouse_id, source, chat_jid, payment_link, payment_link_id`
- `skus`: `selling_price, product_id, barcode, color, size, shopify_variant_id, shopify_inventory_item_id, amazon_asin, flipkart_fsn, zoho_item_id`
- `listings`: `channel_price, channel_mrp, is_deactivated_by_channel, sku_col`

All table names referenced in code map to real tables/views in `schema.sql` — **no
non-existent tables found**.

---

## Mismatches — need code fix

### 1. `qty_on_hand` selected/upserted on `skus` (column lives on `inventory`)

FILE: backend/routers/listings.py
TABLE: skus (embedded via listings)
ISSUE: line 49 selects `listings("*, skus(name, selling_price, qty_on_hand)")` — `qty_on_hand` is on `inventory`, not `skus`.
STATUS: MISMATCH — needs code fix

FILE: backend/routers/catalog.py
TABLE: skus (embedded via products)
ISSUE: line 50 selects `products("*, skus(sku, selling_price, qty_on_hand)")` — `qty_on_hand` not a column on `skus`.
STATUS: MISMATCH — needs code fix

FILE: backend/routers/catalog.py
TABLE: skus
ISSUE: line 363-369 `skus.upsert({..., "qty_on_hand": int(p.get("stock") or 0), ...})` — writes `qty_on_hand` on `skus` which has no such column (belongs to `inventory`).
STATUS: MISMATCH — needs code fix

FILE: backend/catalog/flipkart_importer.py
TABLE: skus
ISSUE: line 101-109 `skus.upsert({..., "qty_on_hand": qty, ...})` — same problem; `qty_on_hand` is not on `skus`.
STATUS: MISMATCH — needs code fix

### 2. `qty_available` selected on `skus` (also lives on `inventory`)

FILE: backend/routers/product_page.py
TABLE: skus (embedded via products)
ISSUE: line 17 selects `products("*, skus(sku, selling_price, mrp, qty_available)")` — `qty_available` is a generated column on `inventory`, not on `skus`.
STATUS: MISMATCH — needs code fix

### 3. `dimensions` column written to `skus` — does not exist

FILE: backend/routers/catalog.py
TABLE: skus
ISSUE: line 127-138 `skus.upsert({..., "dimensions": payload.dimensions or {}, ...})` — schema has `length_cm`, `breadth_cm`, `height_cm` on `skus` but no `dimensions` jsonb column.
STATUS: MISMATCH — needs code fix

### 4. `orders.cancel_reason` — column does not exist

FILE: backend/automation/cod_zone_engine.py
TABLE: orders
ISSUE: line 79-83 `orders.update({"status": "cancelled", "cancel_reason": "cod_blocked_zone", ...})` — `orders` has no `cancel_reason` column (not in base table nor in ALTERs 357-365).
STATUS: MISMATCH — needs code fix

### 5. `products.stock` — column does not exist

FILE: backend/routers/whatsapp.py
TABLE: products
ISSUE: lines 997-1000 select/update `products.stock` — `products` table has no `stock` column (stock lives on `inventory.qty_on_hand`). Code comment calls it a "legacy fallback" but it still targets a non-existent column and will error if reached.
STATUS: MISMATCH — needs code fix (safe to remove the fallback block)

### 6. `inventory.warehouse_id` — column does not exist

FILE: backend/routers/warehouses.py
TABLE: inventory
ISSUE: line 88-97 `inventory.select("*, skus(name, category)").eq("warehouse_id", warehouse_id)` — `inventory` table has no `warehouse_id` column (warehouse routing is on `orders.warehouse_id` and `warehouses` table only).
STATUS: MISMATCH — needs code fix

### 7. `returns.updated_at` — column does not exist

FILE: backend/routers/returns.py
TABLE: returns
ISSUE: line 101-105 `returns.update({..., "updated_at": ...})` — `returns` schema (lines 234-244) defines only `created_at`, no `updated_at`.
STATUS: MISMATCH — needs code fix (drop the `updated_at` key, or add column to schema)

### 8. `products(...) → inventory(...)` embed has no FK path

FILE: backend/routers/whatsapp.py
TABLE: products (embed to inventory)
ISSUE: line 930 selects `products("id, name, skus(sku, selling_price), inventory(qty_available, qty_on_hand)")` — PostgREST needs a FK from `products` to `inventory`. `inventory.sku` FKs to `skus.sku`; there is no direct `products→inventory` relationship, so the embed will fail. The `skus` embed works; `inventory` should be reached via nested embed on `skus`, e.g. `skus(sku, selling_price, inventory(qty_available, qty_on_hand))`.
STATUS: MISMATCH — needs code fix

---

## OK / fixed by schema patch (spot notes)

The following patterns were verified against the schema and are OK — noting a few that
looked suspicious but resolved cleanly against the Phase 2 ALTERs:

- `skus.selling_price` — used throughout (whatsapp.py, listings/engine.py, repricing_engine.py, catalog/sku_mapper.py, catalog/*_importer.py, routers/catalog.py, meta_exporter.py, product_page.py, accounting/zoho.py `zoho_item_id`). STATUS: fixed by schema patch (ALTER at lines 368-377).
- `orders.payment_status / payment_id / amount_paid / paid_at / warehouse_id / source / chat_jid / payment_link / payment_link_id` — used in payments.py, whatsapp.py, meta_commerce.py, warehouses.py, analytics.py. STATUS: fixed by schema patch (ALTERs 357-365).
- `listings.channel_price / channel_mrp / is_deactivated_by_channel` — used in routers/listings.py, listings/engine.py, catalog/*_importer.py. STATUS: fixed by schema patch (ALTERs 380-382).
- `skus.amazon_asin, flipkart_fsn, shopify_variant_id, shopify_inventory_item_id, barcode, color, size, product_id, zoho_item_id` — used in catalog importers and accounting/zoho.py. STATUS: fixed by schema patch (ALTERs 368-377).
- `contacts.*` (phone_e164, whatsapp_jid, is_on_whatsapp, wa_checked_at, business_name, tags, source, notes) — all in base table (lines 423-441). STATUS: OK.
- `warehouses`, `warehouse_routing_rules`, `contact_lists`, `contact_list_members`, `manifests`, `instagram_cues`, `cod_blocked_zones`, `repricing_rules`, `repricing_history`, `competitor_prices`, `products`, `purchase_orders`, `automation_logs`, `notification_log`, `app_settings`, `ndrs`, `shiprocket_tokens`, `channel_credentials`, `tenants` queries — column lists all match. STATUS: OK.
- Views `daily_summary`, `rto_hotspots`, `profit_per_sku` — read-only SELECTs match view columns. STATUS: OK.

---

## Tables referenced in code but not in schema

None — every table/view name used in Supabase calls maps to a definition in `schema.sql`.
