"""
Import active listings from Flipkart Seller Hub into the PIM.
"""
import httpx
import logging
from datetime import datetime, timezone

from ..database import get_db
from ..ingestion.flipkart import FlipkartIngester
from ..automation.logger import log_event

logger = logging.getLogger(__name__)

FLIPKART_BASE = "https://api.flipkart.net/sellers"


class FlipkartCatalogImporter:

    def __init__(self, creds: dict | None = None):
        self._fk = FlipkartIngester(creds=creds)

    def import_all(self) -> dict:
        db = get_db()
        created, updated, errors = 0, 0, 0
        page_token = None

        while True:
            params = {"pageSize": 20, "state": "ACTIVE"}
            if page_token:
                params["pageToken"] = page_token

            try:
                resp = httpx.get(
                    f"{FLIPKART_BASE}/listings/v3",
                    headers=self._fk._headers(),
                    params=params,
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                logger.error(f"[flipkart_import] Failed to fetch listings: {e}")
                errors += 1
                break

            listings = data.get("listingAndInventoryDetailsResponse", [])
            if not listings:
                break

            for listing in listings:
                try:
                    result = self._upsert_listing(db, listing)
                    if result == "created":
                        created += 1
                    else:
                        updated += 1
                except Exception as e:
                    logger.error(f"[flipkart_import] Failed on listing: {e}")
                    errors += 1

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        log_event("catalog_import", "system", "flipkart", "success",
                  f"created={created} updated={updated} errors={errors}")
        return {"channel": "flipkart", "created": created, "updated": updated, "errors": errors}

    def _upsert_listing(self, db, listing: dict) -> str:
        listing_detail = listing.get("listingDetails", {})
        inv = listing.get("inventoryDetails", {})
        pricing = listing_detail.get("sellerListingAttributes", {})

        seller_sku = pricing.get("skuId", "")
        fsn = listing_detail.get("fsn", "")
        title = pricing.get("productTitle", seller_sku)
        mrp = float((pricing.get("mrp") or {}).get("amount", 0))
        selling_price = float((pricing.get("sellingPrice") or {}).get("amount", 0))
        qty = int((inv.get("unitAvailable") or {}).get("quantity", 0))

        # Product upsert
        existing_product = db.table("products").select("id").eq("name", title).execute()
        if existing_product.data:
            product_id = existing_product.data[0]["id"]
            db.table("products").update({
                "is_active": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", product_id).execute()
            action = "updated"
        else:
            result = db.table("products").insert({
                "name": title,
                "is_active": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            product_id = result.data[0]["id"]
            action = "created"

        # SKU upsert
        if seller_sku:
            db.table("skus").upsert({
                "sku": seller_sku,
                "product_id": product_id,
                "mrp": mrp,
                "selling_price": selling_price,
                "flipkart_fsn": fsn,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="sku").execute()

            # Stock lives on inventory table
            db.table("inventory").upsert({
                "sku": seller_sku,
                "qty_on_hand": qty,
                "last_synced_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="sku").execute()

            db.table("listings").upsert({
                "sku": seller_sku,
                "channel": "flipkart",
                "channel_sku_id": seller_sku,
                "listing_id": fsn,
                "channel_price": selling_price,
                "channel_mrp": mrp,
                "is_active": True,
                "last_synced_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="sku,channel").execute()

        return action
