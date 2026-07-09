"""
Shareable product page — served at /p/{product_id}
Two CTAs: Buy on WhatsApp (starts bot conversation) + Pay Now (direct Razorpay checkout).
"""
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from ..database import get_db
from ..config import get_settings

router = APIRouter(tags=["product_page"])
logger = logging.getLogger(__name__)


def _get_product(product_id: str) -> dict:
    db = get_db()
    row = db.table("products").select("*, skus(sku, selling_price, mrp, inventory(qty_available, qty_on_hand))").eq("id", product_id).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Product not found")
    return row.data[0]


def _build_page(product: dict, s) -> str:
    name = product.get("name", "")
    description = (product.get("description") or "").replace("<[^>]+>", "")[:300]
    images = product.get("images") or []
    first_image = images[0] if images else ""
    skus = product.get("skus") or []
    first_sku = skus[0] if skus else {}
    price = first_sku.get("selling_price") or 0
    mrp = first_sku.get("mrp") or price
    sku_code = first_sku.get("sku", "")
    product_id = product.get("id", "")

    # WhatsApp click-to-chat — pre-fills message to the business number
    wa_phone = (s.whatsapp_phone_number_id or "").strip()
    # Use founder WhatsApp as the business contact number for click-to-chat
    business_wa = (s.founder_whatsapp or "").replace("+", "")
    wa_message = f"Hi! I want to buy {name}"
    wa_url = f"https://wa.me/{business_wa}?text={wa_message.replace(' ', '%20')}" if business_wa else "#"

    # Razorpay direct checkout link (creates a payment link on click)
    pay_url = f"{s.app_base_url}/p/{product_id}/pay"

    discount_pct = round((mrp - price) / mrp * 100) if mrp and price and mrp > price else 0

    images_html = ""
    if first_image:
        images_html = f'<img src="{first_image}" alt="{name}" onerror="this.style.display=\'none\'">'

    mrp_html = f'<span class="mrp">₹{mrp:,.0f}</span> <span class="discount">{discount_pct}% off</span>' if discount_pct > 0 else ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>{name}</title>
<meta property="og:title" content="{name}">
<meta property="og:description" content="{description}">
<meta property="og:image" content="{first_image}">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; min-height: 100vh; }}
  .container {{ max-width: 480px; margin: 0 auto; background: #fff; min-height: 100vh; }}
  .image-wrap {{ width: 100%; aspect-ratio: 1; background: #f0f0f0; overflow: hidden; }}
  .image-wrap img {{ width: 100%; height: 100%; object-fit: cover; }}
  .content {{ padding: 20px; }}
  .brand {{ font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }}
  .name {{ font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1.3; margin-bottom: 12px; }}
  .price-row {{ display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }}
  .price {{ font-size: 28px; font-weight: 800; color: #1a1a1a; }}
  .mrp {{ font-size: 16px; color: #aaa; text-decoration: line-through; }}
  .discount {{ font-size: 14px; font-weight: 600; color: #0a8f4e; background: #e6f7ef; padding: 2px 8px; border-radius: 20px; }}
  .desc {{ font-size: 14px; color: #555; line-height: 1.6; margin: 16px 0; }}
  .divider {{ height: 1px; background: #f0f0f0; margin: 20px 0; }}
  .cta-stack {{ display: flex; flex-direction: column; gap: 12px; padding: 0 0 32px; }}
  .btn-wa {{ display: flex; align-items: center; justify-content: center; gap: 10px; background: #25D366; color: #fff; border: none; border-radius: 14px; padding: 16px; font-size: 16px; font-weight: 700; text-decoration: none; cursor: pointer; }}
  .btn-wa:hover {{ background: #1fb954; }}
  .btn-pay {{ display: flex; align-items: center; justify-content: center; gap: 10px; background: #1a1a1a; color: #fff; border: none; border-radius: 14px; padding: 16px; font-size: 16px; font-weight: 700; text-decoration: none; cursor: pointer; }}
  .btn-pay:hover {{ background: #333; }}
  .secure {{ text-align: center; font-size: 12px; color: #aaa; margin-top: 8px; }}
  .wa-icon {{ width: 22px; height: 22px; }}
</style>
</head>
<body>
<div class="container">
  <div class="image-wrap">{images_html}</div>
  <div class="content">
    {f'<div class="brand">{product.get("brand", "")}</div>' if product.get("brand") else ""}
    <div class="name">{name}</div>
    <div class="price-row">
      <span class="price">₹{price:,.0f}</span>
      {mrp_html}
    </div>
    {f'<div class="desc">{description}</div>' if description else ""}
    <div class="divider"></div>
    <div class="cta-stack">
      <a href="{wa_url}" class="btn-wa">
        <svg class="wa-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        Buy on WhatsApp
      </a>
      <a href="{pay_url}" class="btn-pay">
        💳 Pay Now — ₹{price:,.0f}
      </a>
      <div class="secure">🔒 Secured by Razorpay</div>
    </div>
  </div>
</div>
</body>
</html>"""


@router.get("/p/{product_id}", response_class=HTMLResponse)
def product_page(product_id: str):
    """Shareable product page with WhatsApp + Razorpay CTAs."""
    s = get_settings()
    try:
        product = _get_product(product_id)
    except HTTPException:
        return HTMLResponse("<h2>Product not found</h2>", status_code=404)
    return HTMLResponse(_build_page(product, s))


@router.get("/p/{product_id}/pay")
def product_direct_pay(product_id: str):
    """
    Create a Razorpay payment link on the fly for direct checkout.
    Redirects customer to the Razorpay-hosted payment page.
    """
    from fastapi.responses import RedirectResponse
    from .payments import _rz_auth, RAZORPAY_BASE
    import httpx as _httpx

    s = get_settings()
    product = _get_product(product_id)
    skus = product.get("skus") or []
    first_sku = skus[0] if skus else {}
    price = float(first_sku.get("selling_price") or 0)
    name = product.get("name", "")

    if price <= 0:
        raise HTTPException(status_code=400, detail="Product has no price set")

    try:
        auth = _rz_auth()
        payload = {
            "amount": int(price * 100),
            "currency": "INR",
            "description": name,
            "notify": {"sms": True, "email": False},
            "reminder_enable": True,
            "callback_url": f"{s.app_base_url}/api/payments/webhook",
            "notes": {"product_id": product_id, "source": "product_page"},
        }
        resp = _httpx.post(f"{RAZORPAY_BASE}/payment_links", auth=auth, json=payload, timeout=20)
        resp.raise_for_status()
        short_url = resp.json().get("short_url", "")
        if short_url:
            return RedirectResponse(url=short_url)
        raise HTTPException(status_code=502, detail="Could not generate payment link")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
