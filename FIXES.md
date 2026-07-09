# FIXES.md — Priority 1

Live status snapshot after Priority 1 pass on `main`.

## Deployment topology (documented for the record)

- **FastAPI backend → Render** (`d2cflow-backend`, `srv-d9321hok1i2s73dejb10`)
  URL: `https://d2cflow-backend-r8xg.onrender.com` — always-on, runs `uvicorn backend.main:app`, in-process APScheduler starts on boot.
- **WhatsApp Node bridge → Render** (`d2cflow-backend-1`, `srv-d932b18k1i2s73df5dpg`, `whatsapp-bridge/`).
  URL: `https://d2cflow-backend-1.onrender.com`
- **Historical Vercel deploy** (`api/index.py` → `backend.main:app`) still exists at `https://project-zw1nb-8f8wc8aj9-kritika-dagur-s-projects.vercel.app` but is superseded — the scheduler can't run there. Recommend removing/disconnecting.
- Both Render services now track **`github.com/kritikadagur/d2cflow-backend`** on `main` with autoDeploy=yes. Pushes to your fork trigger both rebuilds.
- Previously both services pointed at `raktimtalukdar-cpu/d2cflow-backend` — that's why earlier pushes to your fork appeared to have no effect. Fixed.

## P1a — Audit
- `AUDIT.md` written. 8 real column/table mismatches found; all listed below with their fix.

## P1b — WhatsApp price resolution
- **Backfill:** `UPDATE skus SET selling_price = mrp WHERE selling_price IS NULL AND mrp IS NOT NULL` executed via Supabase REST (service key). 0 rows affected — the DB currently holds 0 SKUs.
- **`backend/routers/whatsapp.py::_get_products`**
  - Now selects `mrp` alongside `selling_price` in the products→skus path.
  - Fallback chain: `selling_price → mrp → 0.0` (matches brief).
  - Fixed FK embed: `inventory` is now nested inside `skus`, not embedded on `products` (there is no direct `products→inventory` FK).
- Ad-hoc unit-verified (4 mock scenarios covering both DB branches and both fallback edges): PASS.

## P1c — Razorpay webhook + auto-ship
No code changes needed. Verified against schema:
- `backend/routers/payments.py::razorpay_webhook` writes exactly `payment_status`, `payment_id`, `amount_paid`, `paid_at`, `status`, `updated_at` — all present in `orders` after Step 0f.
- `_auto_ship_after_payment(order_id)` calls `ShiprocketClient().create_shipment(order, items, sku_weights)` — matches the signature at `backend/couriers/shiprocket.py:58` exactly (positional: order dict, items list, sku_weights dict).

## P1d — Catalog / PDF ingest
- Existing two-step flow kept intact: `POST /api/catalog/import/pdf/preview` → merchant review → `POST /api/catalog/import/pdf/confirm`.
- **NEW:** `POST /api/catalog/upload` — one-shot parse-and-save endpoint matching the brief. Returns `{extracted, saved, skipped, products: [{name, price, sku}, ...]}`.
- Fixed SKU write in confirm handler: `qty_on_hand` moved off the `skus` upsert onto an `inventory` upsert (keyed by sku) — this was silently broken and would have 400'd on real data.

## P1e — Scheduler
**No code change.** `backend/scheduler.py::start_scheduler` already registers all 4 engines required by the brief (`InventoryEngine.run_all` hourly, `OrderAutomationEngine.run_all` every 30min, `ShiprocketClient.auto_ship_rtd_orders` hourly at :15, `ReturnsEngine.run_all` every 6h) plus 11 additional jobs, and calls `scheduler.start()` after `add_job`.

**Now running:** FastAPI is deployed on Render as an always-on service, so `lifespan` fires `start_scheduler()` on boot and the APScheduler thread stays alive between requests. Verified via `/health/detailed` uptime counter.

## P1a audit — 8 mismatches, all fixed

| # | File | Change |
|---|---|---|
| 1 | `backend/routers/listings.py` | `skus(qty_on_hand)` → `skus(inventory(qty_on_hand, qty_available))` (qty lives on `inventory`). |
| 2 | `backend/routers/catalog.py` list_products | Same — nested inventory embed via skus. |
| 3 | `backend/routers/catalog.py` confirm_pdf_import | Split `skus.upsert` + `inventory.upsert`. |
| 4 | `backend/catalog/flipkart_importer.py` | Same split. |
| 5 | `backend/routers/product_page.py` | Same nested embed. |
| 6 | `backend/routers/catalog.py` create_variant | `dimensions` jsonb dropped; write `length_cm/breadth_cm/height_cm` individually. Accepts `{length_cm|length, breadth_cm|breadth|width, height_cm|height}` for client compat. |
| 7 | `backend/automation/cod_zone_engine.py` | Removed `cancel_reason` from orders update (column doesn't exist). Reason preserved in `automation_logs`. |
| 8 | `backend/routers/whatsapp.py` _get_products / stock deduct | Broken `products→inventory` embed rewritten as nested embed via `skus`. Dead `products.stock` legacy fallback removed. |

## Verification

- All 8 touched files pass `python3 -m py_compile`.
- Ad-hoc unit test for `_get_products()` price fallback: PASS (4/4 scenarios).
- 3 seed products/SKUs/inventory rows inserted under tenant `9e107047…` via Supabase REST.
- P1f smoke tests against live Render FastAPI (7/7 PASS):

  | # | Endpoint | Result |
  |---|---|---|
  | 1 | `GET /health` | 200 `{"status":"ok","version":"1.0.0"}` |
  | 2 | `GET /health/detailed` | 200 with metrics + whatsapp block |
  | 3 | `GET /api/orders` | 200 `[]` |
  | 4 | `GET /api/inventory` | 200, 3 rows w/ `qty_available` computed |
  | 5 | `GET /api/whatsapp/bridge-status` | 200 `connected:false, qr_available:true` |
  | 6 | `GET /api/whatsapp/products` | 200, 3 products with non-zero prices |
  | 7 | `GET /api/payments/status` (no JWT) | 401 (correct — auth required) |

## Outstanding — one-time manual steps

1. **Run the missing FK ALTER in Supabase SQL Editor** (once):
   ```sql
   alter table skus drop constraint if exists skus_product_id_fkey;
   alter table skus add constraint skus_product_id_fkey
     foreign key (product_id) references products(id) on delete set null;
   notify pgrst, 'reload schema';
   ```
   Without this, PostgREST cannot embed `products→skus`. Endpoint `/api/whatsapp/products` falls back to the flat `skus` path (works but returns default `stock:99` — real stock never joins in). Applying this FK makes stock=50/30/20 flow through correctly for the seed data.

2. **Decide the Vercel deployment's fate.** It's still there and still deploys on every push. If you want a single source of truth, disconnect the Vercel project or turn off its GitHub integration. FIXES.md now names Render as the canonical FastAPI URL.

3. **Rotate the Render API key** shared during this session.
