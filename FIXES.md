# FIXES.md — Priority 1

Live status snapshot after Priority 1 pass on `main`.

## Deployment topology (documented for the record)

- **FastAPI backend → Vercel** (`api/index.py` → `backend.main:app`).
  URL: `https://project-zw1nb-8f8wc8aj9-kritika-dagur-s-projects.vercel.app`
- **WhatsApp Node bridge → Render** (`whatsapp-bridge/`).
  URL: `https://d2cflow-backend-1.onrender.com`
- Root `render.yaml` declares a `d2cflow-backend` Python service that is **not deployed** (Vercel serves that role). Cleanup TODO.
- Every `git push origin main` triggers **two** auto-deploys (Vercel + Render).

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

**Known blocker (architectural, not fixable in code):** Vercel is serverless — Python processes are killed after each request, so `APScheduler` cannot run there. `main.py::lifespan` calls `start_scheduler()`, but nothing keeps the process alive between requests on Vercel.

**Path forward (deferred):** deploy the declared `d2cflow-backend` service in root `render.yaml` as an always-on Render worker whose sole job is to run APScheduler + the same `backend.main:app`. Then either point traffic there too (single backend) or keep Vercel for HTTP + Render for scheduler. Not doing this now.

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
- Live production endpoints verified:
  - `GET /health` → `{"status":"ok","version":"1.0.0"}`
  - `GET /health/detailed` → whatsapp+metrics blocks populated
  - `GET /api/orders` → `[]` (empty DB)
  - `GET /api/whatsapp/bridge-status` (WA bridge on Render) → `{status:"ok", connected:false, phone:""}`
- Not verified (needs seeded data): `/api/whatsapp/products` non-zero prices, `/api/inventory` rows, `/api/payments/status` (needs Razorpay keys in Vercel env), `/api/catalog/upload` PDF round-trip. Will seed after this deploy.

## Not-in-code-but-worth-flagging

- `.env` missing 10 secrets that live on Vercel: `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET`, `META_APP_ID/APP_SECRET/WEBHOOK_VERIFY_TOKEN`, `SMTP_HOST/PORT/USER/PASSWORD`. Production runs off Vercel's env store; local `.env` is incomplete on purpose.
- Root `render.yaml` `d2cflow-backend` service is a spec-only ghost — either deploy it (P1e path forward) or delete the block.
