"""
Warehouse management API — multi-warehouse support, routing rules, pickup slots.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone

from ..database import get_db
from ..middleware.auth import get_current_user, get_tenant_id

router = APIRouter(prefix="/api/warehouses", tags=["warehouses"])


class WarehousePayload(BaseModel):
    name: str
    code: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    channels: List[str] = []
    pickup_slot_rules: Optional[dict] = None
    weight_rules: Optional[dict] = None


class RoutingRulePayload(BaseModel):
    warehouse_id: str
    rule_type: str
    rule_value: str
    priority: int = 0


@router.get("")
def list_warehouses(user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    return db.table("warehouses").select("*").eq("tenant_id", tenant_id).execute().data


@router.post("")
def create_warehouse(payload: WarehousePayload, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    result = db.table("warehouses").insert({
        "tenant_id": tenant_id,
        "name": payload.name,
        "code": payload.code,
        "address": payload.address,
        "city": payload.city,
        "state": payload.state,
        "pincode": payload.pincode,
        "channels": payload.channels,
        "pickup_slot_rules": payload.pickup_slot_rules or {},
        "weight_rules": payload.weight_rules or {},
        "is_active": True,
    }).execute()
    return result.data[0]


@router.put("/{warehouse_id}")
def update_warehouse(warehouse_id: str, payload: WarehousePayload, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    db.table("warehouses").update({
        "name": payload.name,
        "code": payload.code,
        "address": payload.address,
        "city": payload.city,
        "state": payload.state,
        "pincode": payload.pincode,
        "channels": payload.channels,
        "pickup_slot_rules": payload.pickup_slot_rules or {},
        "weight_rules": payload.weight_rules or {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", warehouse_id).eq("tenant_id", tenant_id).execute()
    return {"status": "updated"}


@router.delete("/{warehouse_id}")
def delete_warehouse(warehouse_id: str, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    db.table("warehouses").update({"is_active": False}).eq("id", warehouse_id).eq("tenant_id", tenant_id).execute()
    return {"status": "deactivated"}


@router.get("/{warehouse_id}/inventory")
def warehouse_inventory(warehouse_id: str, user=Depends(get_current_user)):
    """
    Inventory for a warehouse.

    Schema note: `inventory` is not keyed by warehouse — it holds one row per SKU with
    global on-hand qty. Warehouse routing is on `orders.warehouse_id` + `warehouses` +
    `warehouse_routing_rules`. Until per-warehouse inventory is added to the schema, we
    return the tenant's global inventory alongside the warehouse's SKU catalog.
    """
    db = get_db()
    return (
        db.table("inventory")
        .select("*, skus(name, category)")
        .execute()
        .data
    )


@router.post("/routing-rules")
def create_routing_rule(payload: RoutingRulePayload, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    result = db.table("warehouse_routing_rules").insert({
        "tenant_id": tenant_id,
        "warehouse_id": payload.warehouse_id,
        "rule_type": payload.rule_type,
        "rule_value": payload.rule_value,
        "priority": payload.priority,
    }).execute()
    return result.data[0]


@router.get("/routing-rules")
def list_routing_rules(user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    return db.table("warehouse_routing_rules").select("*, warehouses(name, code)").eq("tenant_id", tenant_id).order("priority").execute().data


@router.delete("/routing-rules/{rule_id}")
def delete_routing_rule(rule_id: str, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    db.table("warehouse_routing_rules").delete().eq("id", rule_id).eq("tenant_id", tenant_id).execute()
    return {"status": "deleted"}


@router.post("/{warehouse_id}/schedule-pickup")
def schedule_warehouse_pickup(warehouse_id: str, pickup_date: str, courier: str = "shiprocket", user=Depends(get_current_user)):
    db = get_db()
    # Get all RTD orders for this warehouse
    rtd_orders = (
        db.table("orders")
        .select("id, awb, shiprocket_order_id")
        .eq("status", "rtd")
        .eq("warehouse_id", warehouse_id)
        .not_.is_("awb", "null")
        .execute()
    )
    if not rtd_orders.data:
        return {"status": "no_orders", "count": 0}

    if courier == "shiprocket":
        from ..couriers.shiprocket import ShiprocketClient
        shipment_ids = [int(o["shiprocket_order_id"]) for o in rtd_orders.data if o.get("shiprocket_order_id")]
        ShiprocketClient().schedule_pickup(shipment_ids, pickup_date)
    elif courier == "delhivery":
        from ..couriers.delhivery import DelhiveryClient
        awbs = [o["awb"] for o in rtd_orders.data if o.get("awb")]
        DelhiveryClient().schedule_pickup(awbs, pickup_date)

    return {"status": "scheduled", "count": len(rtd_orders.data), "pickup_date": pickup_date}
