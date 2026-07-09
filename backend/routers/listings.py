"""
Listings management API — push/sync products to marketplace channels,
manage pricing, deactivated listing alerts, and repricing rules.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone

from ..database import get_db
from ..middleware.auth import get_current_user, get_tenant_id

router = APIRouter(prefix="/api/listings", tags=["listings"])


class ListingPayload(BaseModel):
    sku: str
    channel: str
    channel_sku_id: Optional[str] = None
    listing_id: Optional[str] = None
    channel_price: Optional[float] = None
    channel_mrp: Optional[float] = None
    is_active: bool = True


class RepricingRulePayload(BaseModel):
    sku: str
    channel: Optional[str] = None
    strategy: str  # "beat_by_pct" | "match_lowest" | "fixed_markup"
    beat_by_pct: Optional[float] = 1.0
    markup_pct: Optional[float] = 20.0
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    is_active: bool = True


class MyntraOfferPayload(BaseModel):
    offers: List[dict]  # [{sku_id, mrp, selling_price, discount_pct, offer_valid_from, offer_valid_to}]


@router.get("")
def list_listings(
    channel: Optional[str] = None,
    sku: Optional[str] = None,
    deactivated_only: bool = False,
    user=Depends(get_current_user),
):
    db = get_db()
    q = db.table("listings").select("*, skus(name, selling_price, inventory(qty_on_hand, qty_available))").limit(200)
    if channel:
        q = q.eq("channel", channel)
    if sku:
        q = q.eq("sku", sku)
    if deactivated_only:
        q = q.eq("is_deactivated_by_channel", True)
    return q.execute().data


@router.post("")
def create_listing(payload: ListingPayload, user=Depends(get_current_user)):
    db = get_db()
    result = db.table("listings").upsert({
        "sku": payload.sku,
        "channel": payload.channel,
        "channel_sku_id": payload.channel_sku_id,
        "listing_id": payload.listing_id,
        "channel_price": payload.channel_price,
        "channel_mrp": payload.channel_mrp,
        "is_active": payload.is_active,
        "is_deactivated_by_channel": False,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="sku,channel").execute()
    return result.data[0]


@router.delete("/{listing_id}")
def remove_listing(listing_id: str, user=Depends(get_current_user)):
    db = get_db()
    db.table("listings").update({"is_active": False}).eq("id", listing_id).execute()
    return {"status": "deactivated"}


@router.post("/sync-prices")
def sync_prices(user=Depends(get_current_user)):
    from ..listings.engine import ListingEngine
    ListingEngine().sync_prices_to_channels()
    return {"status": "ok"}


@router.post("/detect-deactivated")
def detect_deactivated(user=Depends(get_current_user)):
    from ..listings.engine import ListingEngine
    ListingEngine().detect_deactivated_listings()
    return {"status": "ok"}


@router.post("/push/{product_id}")
def push_product_to_channel(product_id: str, channel: str, user=Depends(get_current_user)):
    from ..listings.engine import ListingEngine
    try:
        result = ListingEngine().push_listing_to_channel(product_id, channel)
        return {"status": "pushed", **result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------ #
# Repricing rules
# ------------------------------------------------------------------ #

@router.get("/repricing/rules")
def list_repricing_rules(user=Depends(get_current_user)):
    db = get_db()
    return db.table("repricing_rules").select("*").order("created_at", desc=True).execute().data


@router.post("/repricing/rules")
def create_repricing_rule(payload: RepricingRulePayload, user=Depends(get_current_user)):
    db = get_db()
    result = db.table("repricing_rules").upsert({
        "sku": payload.sku,
        "channel": payload.channel,
        "strategy": payload.strategy,
        "beat_by_pct": payload.beat_by_pct,
        "markup_pct": payload.markup_pct,
        "min_price": payload.min_price,
        "max_price": payload.max_price,
        "is_active": payload.is_active,
    }, on_conflict="sku,channel").execute()
    return result.data[0]


@router.delete("/repricing/rules/{rule_id}")
def delete_repricing_rule(rule_id: str, user=Depends(get_current_user)):
    db = get_db()
    db.table("repricing_rules").delete().eq("id", rule_id).execute()
    return {"status": "deleted"}


@router.post("/repricing/run")
def run_repricing(user=Depends(get_current_user)):
    from ..automation.repricing_engine import RepricingEngine
    RepricingEngine().run_all()
    return {"status": "ok"}


@router.get("/repricing/history")
def repricing_history(sku: Optional[str] = None, limit: int = 50, user=Depends(get_current_user)):
    db = get_db()
    q = db.table("repricing_history").select("*").order("created_at", desc=True).limit(limit)
    if sku:
        q = q.eq("sku", sku)
    return q.execute().data


# ------------------------------------------------------------------ #
# Competitor prices
# ------------------------------------------------------------------ #

@router.get("/competitor-prices")
def get_competitor_prices(sku: Optional[str] = None, user=Depends(get_current_user)):
    db = get_db()
    q = db.table("competitor_prices").select("*").order("fetched_at", desc=True)
    if sku:
        q = q.eq("sku", sku)
    return q.execute().data


# ------------------------------------------------------------------ #
# COD zones
# ------------------------------------------------------------------ #

@router.get("/cod-zones")
def list_cod_zones(user=Depends(get_current_user)):
    from ..automation.cod_zone_engine import CODZoneEngine
    return CODZoneEngine().get_blocked_zones()


@router.post("/cod-zones/block")
def block_cod_zone(pincode: str, state: str, reason: str = "manual", user=Depends(get_current_user)):
    from ..automation.cod_zone_engine import CODZoneEngine
    CODZoneEngine().block_zone(pincode, state, reason)
    return {"status": "blocked", "pincode": pincode}


@router.post("/cod-zones/unblock")
def unblock_cod_zone(pincode: str, user=Depends(get_current_user)):
    from ..automation.cod_zone_engine import CODZoneEngine
    CODZoneEngine().unblock_zone(pincode)
    return {"status": "unblocked", "pincode": pincode}


# ------------------------------------------------------------------ #
# Myntra offer file upload
# ------------------------------------------------------------------ #

@router.post("/myntra/upload-offers")
def upload_myntra_offers(payload: MyntraOfferPayload, user=Depends(get_current_user)):
    from ..listings.engine import ListingEngine
    try:
        result = ListingEngine().upload_myntra_offer_file(payload.offers)
        return {"status": "uploaded", **result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------ #
# Manifests
# ------------------------------------------------------------------ #

@router.post("/manifests/generate")
def generate_manifest(warehouse_id: Optional[str] = None, courier: Optional[str] = None, user=Depends(get_current_user)):
    from ..automation.manifest_engine import ManifestEngine
    return ManifestEngine().generate_manifest(warehouse_id=warehouse_id, courier=courier)


@router.get("/manifests")
def list_manifests(warehouse_id: Optional[str] = None, user=Depends(get_current_user)):
    from ..automation.manifest_engine import ManifestEngine
    return ManifestEngine().list_manifests(warehouse_id=warehouse_id)
