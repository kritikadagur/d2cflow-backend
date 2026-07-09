"""
COD zone management — region-based COD toggling to reduce fraud and RTOs.
Block risky pincodes/states for COD, or require confirmation before allowing.
"""
import logging
from datetime import datetime, timezone
from ..database import get_db
from ..config import get_settings
from ..automation.logger import log_event

logger = logging.getLogger(__name__)


class CODZoneEngine:

    def run_all(self):
        self.auto_block_high_rto_zones()
        self.cancel_unconfirmed_cod_orders()

    # ------------------------------------------------------------------ #
    # Auto-block pincodes with >X% RTO rate
    # ------------------------------------------------------------------ #
    def auto_block_high_rto_zones(self):
        db = get_db()
        s = get_settings()

        hotspots = (
            db.table("rto_hotspots")
            .select("pincode, state, rto_rate_pct, total_orders")
            .gt("rto_rate_pct", 40)  # >40% RTO = block
            .gt("total_orders", 3)   # need at least 3 data points
            .execute()
        )

        for h in hotspots.data:
            existing = (
                db.table("cod_blocked_zones")
                .select("id")
                .eq("pincode", h["pincode"])
                .execute()
            )
            if existing.data:
                continue

            db.table("cod_blocked_zones").insert({
                "pincode": h["pincode"],
                "state": h["state"],
                "reason": "auto_high_rto",
                "rto_rate_pct": h["rto_rate_pct"],
                "is_active": True,
            }).execute()
            log_event("cod_zone_blocked", "pincode", h["pincode"], "success",
                      f"RTO rate {h['rto_rate_pct']}% — COD blocked")

    # ------------------------------------------------------------------ #
    # Cancel COD orders that weren't confirmed within timeout
    # ------------------------------------------------------------------ #
    def cancel_unconfirmed_cod_orders(self):
        db = get_db()
        s = get_settings()
        from datetime import timedelta

        cutoff = (datetime.now(timezone.utc) - timedelta(hours=s.cod_confirm_timeout_hours)).isoformat()

        unconfirmed = (
            db.table("orders")
            .select("id, channel_order_id, customer_phone, customer_name")
            .eq("payment_mode", "cod")
            .eq("status", "confirmed")
            .is_("cod_confirmed", "null")
            .lt("created_at", cutoff)
            .execute()
        )

        for order in unconfirmed.data:
            # Check if in a blocked zone
            blocked = self.is_cod_blocked(order.get("pincode", ""))
            if blocked:
                # Reason stored via automation_logs (orders has no cancel_reason column)
                db.table("orders").update({
                    "status": "cancelled",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", order["id"]).execute()
                log_event("cod_auto_cancelled", "order", order["channel_order_id"], "success",
                          "COD blocked zone — auto cancelled")

    # ------------------------------------------------------------------ #
    # Check if pincode is COD-blocked
    # ------------------------------------------------------------------ #
    def is_cod_blocked(self, pincode: str) -> bool:
        if not pincode:
            return False
        db = get_db()
        result = (
            db.table("cod_blocked_zones")
            .select("id")
            .eq("pincode", pincode)
            .eq("is_active", True)
            .execute()
        )
        return bool(result.data)

    # ------------------------------------------------------------------ #
    # Manually block/unblock a zone
    # ------------------------------------------------------------------ #
    def block_zone(self, pincode: str, state: str, reason: str):
        db = get_db()
        db.table("cod_blocked_zones").upsert({
            "pincode": pincode,
            "state": state,
            "reason": reason,
            "is_active": True,
            "blocked_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="pincode").execute()
        log_event("cod_zone_blocked", "pincode", pincode, "success", f"Manual block: {reason}")

    def unblock_zone(self, pincode: str):
        db = get_db()
        db.table("cod_blocked_zones").update({
            "is_active": False,
            "unblocked_at": datetime.now(timezone.utc).isoformat(),
        }).eq("pincode", pincode).execute()
        log_event("cod_zone_unblocked", "pincode", pincode, "success")

    def get_blocked_zones(self) -> list:
        db = get_db()
        return db.table("cod_blocked_zones").select("*").eq("is_active", True).order("rto_rate_pct", desc=True).execute().data
