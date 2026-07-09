"""
Returns & RTO management API.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from ..database import get_db
from ..middleware.auth import get_current_user

router = APIRouter(prefix="/api/returns", tags=["returns"])


class ClaimUpdatePayload(BaseModel):
    claim_status: str
    claim_amount: Optional[float] = None
    notes: Optional[str] = None


@router.get("")
def list_returns(
    status: Optional[str] = None,
    channel: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user),
):
    db = get_db()
    q = (
        db.table("returns")
        .select("*, orders(channel_order_id, channel, customer_name, customer_phone, total_amount, awb, courier, pincode, state, payment_mode)")
        .order("created_at", desc=True)
        .limit(limit)
    )
    if status:
        q = q.eq("return_status", status)
    if channel:
        q = q.eq("channel", channel)
    return q.execute().data


@router.get("/summary")
def returns_summary(user=Depends(get_current_user)):
    db = get_db()
    returns = db.table("returns").select("return_status, claim_filed, claim_status, orders(total_amount, channel, payment_mode)").execute()

    total = len(returns.data)
    by_status: dict = {}
    by_channel: dict = {}
    total_claimed = 0
    total_recovered = 0

    for r in returns.data:
        s = r.get("return_status", "unknown")
        by_status[s] = by_status.get(s, 0) + 1

        order = r.get("orders") or {}
        ch = order.get("channel", "unknown")
        by_channel[ch] = by_channel.get(ch, 0) + 1

        if r.get("claim_filed"):
            total_claimed += 1
        if r.get("claim_status") == "settled":
            total_recovered += float((order.get("total_amount") or 0))

    return {
        "total": total,
        "by_status": by_status,
        "by_channel": by_channel,
        "claims_filed": total_claimed,
        "amount_recovered": round(total_recovered, 2),
    }


@router.get("/hotspots")
def rto_hotspots(limit: int = 20, user=Depends(get_current_user)):
    db = get_db()
    return (
        db.table("rto_hotspots")
        .select("*")
        .gt("total_orders", 2)
        .order("rto_rate_pct", desc=True)
        .limit(limit)
        .execute()
        .data
    )


@router.post("/process")
def run_returns_engine(user=Depends(get_current_user)):
    from ..automation.returns_engine import ReturnsEngine
    engine = ReturnsEngine()
    engine.run_all()
    engine.file_courier_claims()
    return {"status": "ok"}


@router.patch("/{return_id}/claim")
def update_claim(return_id: str, payload: ClaimUpdatePayload, user=Depends(get_current_user)):
    db = get_db()
    db.table("returns").update({
        "claim_status": payload.claim_status,
        "claim_amount": payload.claim_amount,
    }).eq("id", return_id).execute()
    return {"status": "updated"}


@router.get("/cod-zones")
def cod_blocked_zones(user=Depends(get_current_user)):
    from ..automation.cod_zone_engine import CODZoneEngine
    return CODZoneEngine().get_blocked_zones()
