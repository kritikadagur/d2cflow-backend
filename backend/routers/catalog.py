"""
Catalog / PIM API — product catalog management with AI-assisted generation.
"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone

from ..database import get_db
from ..middleware.auth import get_current_user, get_tenant_id

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


class ProductPayload(BaseModel):
    name: str
    description: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    hsn_code: Optional[str] = None
    gst_rate: Optional[float] = None
    images: List[str] = []
    tags: List[str] = []
    is_active: bool = True


class VariantPayload(BaseModel):
    product_id: str
    sku: str
    barcode: Optional[str] = None
    weight_grams: Optional[float] = 500
    dimensions: Optional[dict] = None
    color: Optional[str] = None
    size: Optional[str] = None
    mrp: Optional[float] = None
    cost_price: Optional[float] = None
    selling_price: Optional[float] = None


@router.get("")
def list_products(
    category: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    user=Depends(get_current_user)
):
    db = get_db()
    tenant_id = get_tenant_id(user)
    q = db.table("products").select("*, skus(sku, selling_price, inventory(qty_on_hand, qty_available))").eq("tenant_id", tenant_id).limit(limit)
    if category:
        q = q.eq("category", category)
    if search:
        q = q.ilike("name", f"%{search}%")
    return q.execute().data


@router.post("")
def create_product(payload: ProductPayload, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    result = db.table("products").insert({
        "tenant_id": tenant_id,
        "name": payload.name,
        "description": payload.description,
        "brand": payload.brand,
        "category": payload.category,
        "sub_category": payload.sub_category,
        "hsn_code": payload.hsn_code,
        "gst_rate": payload.gst_rate,
        "images": payload.images,
        "tags": payload.tags,
        "is_active": payload.is_active,
    }).execute()
    return result.data[0]


@router.get("/{product_id}")
def get_product(product_id: str, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    result = (
        db.table("products")
        .select("*, skus(*), listings(channel, channel_sku_id, channel_price, is_active, is_deactivated_by_channel)")
        .eq("id", product_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found")
    return result.data[0]


@router.put("/{product_id}")
def update_product(product_id: str, payload: ProductPayload, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    db.table("products").update({
        "name": payload.name,
        "description": payload.description,
        "brand": payload.brand,
        "category": payload.category,
        "sub_category": payload.sub_category,
        "hsn_code": payload.hsn_code,
        "gst_rate": payload.gst_rate,
        "images": payload.images,
        "tags": payload.tags,
        "is_active": payload.is_active,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", product_id).eq("tenant_id", tenant_id).execute()
    return {"status": "updated"}


@router.delete("/{product_id}")
def delete_product(product_id: str, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    db.table("products").update({"is_active": False}).eq("id", product_id).eq("tenant_id", tenant_id).execute()
    return {"status": "deactivated"}


@router.post("/variants")
def create_variant(payload: VariantPayload, user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    dims = payload.dimensions or {}
    # Upsert into skus table
    result = db.table("skus").upsert({
        "sku": payload.sku,
        "product_id": payload.product_id,
        "barcode": payload.barcode,
        "weight_grams": payload.weight_grams,
        "length_cm":  dims.get("length_cm")  or dims.get("length"),
        "breadth_cm": dims.get("breadth_cm") or dims.get("breadth") or dims.get("width"),
        "height_cm":  dims.get("height_cm")  or dims.get("height"),
        "color": payload.color,
        "size": payload.size,
        "mrp": payload.mrp,
        "cost_price": payload.cost_price,
        "selling_price": payload.selling_price,
    }, on_conflict="sku").execute()
    return result.data[0]


@router.post("/{product_id}/push-to-channel")
def push_to_channel(product_id: str, channel: str, user=Depends(get_current_user)):
    from ..listings.engine import ListingEngine
    try:
        result = ListingEngine().push_listing_to_channel(product_id, channel)
        return {"status": "pushed", "channel": channel, **result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/categories/list")
def list_categories(user=Depends(get_current_user)):
    db = get_db()
    tenant_id = get_tenant_id(user)
    result = db.table("products").select("category").eq("tenant_id", tenant_id).execute()
    categories = list({r["category"] for r in result.data if r.get("category")})
    return sorted(categories)


@router.post("/{product_id}/generate-description")
def generate_description(product_id: str, tone: str = "professional", user=Depends(get_current_user)):
    """AI-assisted product description generation."""
    db = get_db()
    tenant_id = get_tenant_id(user)
    product = db.table("products").select("*").eq("id", product_id).eq("tenant_id", tenant_id).execute()
    if not product.data:
        raise HTTPException(status_code=404, detail="Product not found")

    p = product.data[0]
    # Return structured prompt result (LLM call can be added here)
    name = p.get("name", "")
    brand = p.get("brand", "")
    category = p.get("category", "")
    tags = ", ".join(p.get("tags", []))

    generated = (
        f"{name} by {brand}. A premium {category} product. "
        f"Key features: {tags}. Perfect for everyday use. "
        f"High quality materials, thoughtfully designed for Indian consumers."
    )
    return {"product_id": product_id, "generated_description": generated, "tone": tone}


# ------------------------------------------------------------------ #
# Catalog import from channels
# ------------------------------------------------------------------ #

@router.post("/import/shopify")
def import_from_shopify(user=Depends(get_current_user)):
    """Pull all products from Shopify into the PIM using tenant credentials."""
    from ..catalog.importer_factory import get_importer
    db = get_db()
    tenant_id = get_tenant_id(user)
    try:
        return get_importer("shopify", tenant_id).import_all()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/import/amazon")
def import_from_amazon(user=Depends(get_current_user)):
    """Pull active listings from Amazon SP-API into the PIM using tenant credentials."""
    from ..catalog.importer_factory import get_importer
    db = get_db()
    tenant_id = get_tenant_id(user)
    try:
        return get_importer("amazon", tenant_id).import_all()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/import/flipkart")
def import_from_flipkart(user=Depends(get_current_user)):
    """Pull active listings from Flipkart into the PIM using tenant credentials."""
    from ..catalog.importer_factory import get_importer
    db = get_db()
    tenant_id = get_tenant_id(user)
    try:
        return get_importer("flipkart", tenant_id).import_all()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/import/all")
def import_from_all_channels(user=Depends(get_current_user)):
    """Import catalog from all connected channels in one shot."""
    from ..catalog.importer_factory import get_importer
    db = get_db()
    tenant_id = get_tenant_id(user)
    results = {}
    for channel in ("shopify", "amazon", "flipkart"):
        try:
            results[channel] = get_importer(channel, tenant_id).import_all()
        except ValueError as e:
            results[channel] = {"skipped": str(e)}
        except Exception as e:
            results[channel] = {"error": str(e)}
    return results


@router.post("/sku-mapping/run")
def run_sku_mapping(user=Depends(get_current_user)):
    """Resolve unmapped order_items SKUs against the catalog."""
    from ..catalog.sku_mapper import SKUMapper
    return SKUMapper().bulk_map_unmapped_orders()


@router.get("/sku-mapping/unmapped")
def list_unmapped_skus(limit: int = 100, user=Depends(get_current_user)):
    """List order items that still have no resolved internal SKU."""
    db = get_db()
    return (
        db.table("order_items")
        .select("id, channel_sku_id, name, orders(channel, channel_order_id, created_at)")
        .is_("sku", "null")
        .limit(limit)
        .execute()
        .data
    )


@router.post("/bulk-update")
def bulk_update_products(updates: List[dict], user=Depends(get_current_user)):
    """Bulk update product information (price, status, category, etc.)."""
    db = get_db()
    tenant_id = get_tenant_id(user)
    updated = 0
    errors = []

    for update in updates:
        product_id = update.pop("id", None)
        sku = update.pop("sku", None)
        if not product_id and not sku:
            errors.append("Missing id or sku")
            continue
        try:
            if product_id:
                db.table("products").update({**update, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", product_id).eq("tenant_id", tenant_id).execute()
            else:
                db.table("skus").update({**update, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("sku", sku).execute()
            updated += 1
        except Exception as e:
            errors.append(str(e))

    return {"updated": updated, "errors": errors}


# ------------------------------------------------------------------ #
# PDF catalog upload — parse → preview → confirm save
# ------------------------------------------------------------------ #

@router.post("/import/pdf/preview")
async def preview_pdf_catalog(file: UploadFile = File(...)):
    """
    Upload a PDF catalog. Returns extracted products for merchant review.
    Nothing is saved until /import/pdf/confirm is called.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:  # 20MB limit
        raise HTTPException(status_code=400, detail="PDF too large. Max 20MB.")

    try:
        from ..catalog.pdf_importer import parse_pdf_catalog
        products = parse_pdf_catalog(contents)
    except ImportError:
        raise HTTPException(status_code=503, detail="PDF parsing not available. Run: pip install pdfplumber")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse PDF: {e}")

    if not products:
        raise HTTPException(
            status_code=422,
            detail="No products found in this PDF. The PDF needs product names and prices (₹ or INR format)."
        )

    return {
        "preview": products,
        "count": len(products),
        "message": f"Found {len(products)} products. Review and confirm to add them to your catalog.",
    }


class ConfirmPdfImport(BaseModel):
    products: List[dict]  # The previewed products, optionally edited by merchant


@router.post("/import/pdf/confirm")
def confirm_pdf_import(payload: ConfirmPdfImport, user=Depends(get_current_user)):
    """Save the reviewed PDF products into the catalog."""
    db = get_db()
    tenant_id = get_tenant_id(user)
    created, skipped = 0, 0

    for p in payload.products:
        name = (p.get("name") or "").strip()
        price = float(p.get("price") or 0)
        if not name or price <= 0:
            skipped += 1
            continue

        # Create product
        prod_result = db.table("products").insert({
            "tenant_id": tenant_id,
            "name": name,
            "description": p.get("description", ""),
            "category": p.get("category", ""),
            "is_active": True,
            "tags": ["pdf_import"],
        }).execute()
        product_id = prod_result.data[0]["id"]

        # Generate SKU if not provided
        sku_code = (p.get("sku") or "").strip()
        if not sku_code:
            import re as _re
            sku_code = _re.sub(r"[^A-Z0-9]", "-", name.upper())[:20].strip("-") + f"-{product_id[:6].upper()}"

        mrp = float(p.get("mrp") or price)
        sku_row = db.table("skus").upsert({
            "sku": sku_code,
            "product_id": product_id,
            "name": name,
            "selling_price": price,
            "mrp": mrp if mrp >= price else price,
        }, on_conflict="sku").execute()

        # Stock lives on inventory (schema: inventory.qty_on_hand), not on skus
        stock = int(p.get("stock") or 0)
        if stock:
            db.table("inventory").upsert({
                "sku": sku_code,
                "qty_on_hand": stock,
            }, on_conflict="sku").execute()

        created += 1

    return {
        "created": created,
        "skipped": skipped,
        "message": f"{created} products added to your catalog.",
    }
