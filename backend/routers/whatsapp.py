"""
WhatsApp Order Intake router.

All bridge paths are configurable via environment variables so the backend
can run in production (Render) without hardcoded local paths.

Environment variables (all optional, have local-dev defaults):
  WHATSAPP_BRIDGE_BINARY  — path to the whatsapp-bridge binary
  WHATSAPP_BRIDGE_DIR     — working directory for the bridge process
  WHATSAPP_BRIDGE_API     — base URL of the bridge HTTP API  (default: http://localhost:8080)
  WHATSAPP_DB_PATH        — path to messages.db
  WHATSAPP_DEVICE_DB      — path to whatsapp.db (device auth)
  D2CFLOW_STORE_DIR       — directory for persisted JSON state (default: ~/.d2cflow)
"""

import base64
import io
import json
import logging
import os
import re
import sqlite3
import subprocess
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

import httpx
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import get_settings
from ..database import get_db

# ── Config (all overridable via env vars) ─────────────────────────────────────

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DEFAULT_BRIDGE_DIR = os.path.join(_PROJECT_ROOT, "whatsapp-bridge")
BRIDGE_BINARY: str = os.environ.get("WHATSAPP_BRIDGE_BINARY") or os.path.join(_DEFAULT_BRIDGE_DIR, "start.sh")
BRIDGE_DIR: str = os.environ.get("WHATSAPP_BRIDGE_DIR") or _DEFAULT_BRIDGE_DIR
BRIDGE_API: str = os.environ.get("WHATSAPP_BRIDGE_API", "http://localhost:8080")
WHATSAPP_DB_PATH: str = os.environ.get(
    "WHATSAPP_DB_PATH",
    os.path.join(BRIDGE_DIR, "store", "messages.db"),
)
WHATSAPP_DEVICE_DB: str = os.environ.get(
    "WHATSAPP_DEVICE_DB",
    os.path.join(BRIDGE_DIR, "store", "whatsapp.db"),
)
_STORE_DIR: str = os.environ.get(
    "D2CFLOW_STORE_DIR", os.path.expanduser("~/.d2cflow")
)
_CHATS_FILE         = os.path.join(_STORE_DIR, "wa_monitored_chats.json")
_ORDERS_FILE        = os.path.join(_STORE_DIR, "wa_detected_orders.json")
_REPLIES_FILE       = os.path.join(_STORE_DIR, "wa_drafted_replies.json")
_CONFIRMATIONS_FILE = os.path.join(_STORE_DIR, "wa_confirmations.json")
_CONV_STATES_FILE   = os.path.join(_STORE_DIR, "wa_conv_states.json")
_BROADCASTS_FILE    = os.path.join(_STORE_DIR, "wa_broadcasts.json")

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])
logger = logging.getLogger(__name__)


# ── SQLite Setup ──────────────────────────────────────────────────────────────

def _init_sqlite_db():
    try:
        db_dir = os.path.dirname(WHATSAPP_DB_PATH)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        conn = sqlite3.connect(WHATSAPP_DB_PATH)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_jid TEXT,
                sender TEXT,
                content TEXT,
                timestamp TEXT,
                is_from_me INTEGER DEFAULT 0
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS chats (
                jid TEXT PRIMARY KEY,
                name TEXT,
                last_message_time TEXT
            )
        """)
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning("Could not initialize local SQLite tables: %s", e)

_init_sqlite_db()



# ── Persistent JSON helpers ───────────────────────────────────────────────────

def _load_json(path: str, default):
    try:
        os.makedirs(_STORE_DIR, exist_ok=True)
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
    except Exception:
        pass
    return default


def _save_json(path: str, data) -> None:
    try:
        os.makedirs(_STORE_DIR, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)
    except Exception as e:
        logger.warning("Could not save %s: %s", path, e)


# ── In-memory stores (all seeded from disk — survive restarts) ────────────────

_monitored_chats: List[dict]      = _load_json(_CHATS_FILE, [])
_detected_orders: List[dict]      = _load_json(_ORDERS_FILE, [])
_drafted_replies: List[dict]      = _load_json(_REPLIES_FILE, [])
_pending_confirmations: List[dict] = _load_json(_CONFIRMATIONS_FILE, [])
_conversation_states: dict        = _load_json(_CONV_STATES_FILE, {})
# _pending_broadcasts: one entry per CRM send, never overwritten — supports multiple orders per contact
_pending_broadcasts: List[dict]   = _load_json(_BROADCASTS_FILE, [])
_synced_products: List[dict]      = []


def _persist_all() -> None:
    """Flush all mutable state to disk at once."""
    _save_json(_ORDERS_FILE, _detected_orders)
    _save_json(_REPLIES_FILE, _drafted_replies)
    _save_json(_CONFIRMATIONS_FILE, _pending_confirmations)
    _save_json(_BROADCASTS_FILE, _pending_broadcasts)
    _save_json(_CONV_STATES_FILE, _conversation_states)


def _has_supabase_config() -> bool:
    s = get_settings()
    return bool(s.supabase_url and s.supabase_service_key)


def _safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return default


def _safe_int(value, default: int = 1) -> int:
    try:
        if value is None or value == "":
            return default
        return max(1, int(float(value)))
    except (TypeError, ValueError):
        return default


def _safe_nonnegative_int(value, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return default


def _phone_from_jid(jid: str) -> str:
    return (jid or "").split("@")[0].split("-")[0]


def _total_for_items(items: List[dict]) -> float:
    return sum(_safe_float(i.get("price") or i.get("unit_price")) * _safe_int(i.get("qty")) for i in items)


def _order_total(order: dict) -> float:
    items = order.get("items") or []
    return _safe_float(order.get("total"), _total_for_items(items) or _safe_float(order.get("price")))


def _normalise_wa_items(order: dict, db=None) -> List[dict]:
    raw_items = order.get("items") or []
    if not raw_items:
        raw_items = [{
            "name": order.get("product_hint") or "WhatsApp Order",
            "sku": order.get("product_sku"),
            "product_id": order.get("product_id"),
            "qty": order.get("qty", 1),
            "price": order.get("catalog_price") or order.get("price") or 0,
        }]

    rows = []
    sku_candidates = set()
    for item in raw_items:
        sku = item.get("sku") or item.get("product_sku")
        if sku and sku != "—":
            sku_candidates.add(str(sku))

    existing_skus = set()
    if db and sku_candidates:
        try:
            result = db.table("skus").select("sku").in_("sku", list(sku_candidates)).execute()
            existing_skus = {r["sku"] for r in result.data or [] if r.get("sku")}
        except Exception as e:
            logger.debug("Could not validate WhatsApp item SKUs: %s", e)

    for item in raw_items:
        sku = item.get("sku") or item.get("product_sku")
        sku = str(sku) if sku and sku != "—" else None
        qty = _safe_int(item.get("qty"), _safe_int(order.get("qty")))
        unit_price = _safe_float(item.get("unit_price"), _safe_float(item.get("price"), _safe_float(order.get("catalog_price") or order.get("price"))))
        rows.append({
            "sku": sku if sku in existing_skus else None,
            "channel_sku_id": item.get("channel_sku_id") or sku or item.get("product_id") or order.get("product_id"),
            "name": item.get("name") or item.get("product_name") or order.get("product_hint") or "WhatsApp Order",
            "qty": qty,
            "unit_price": unit_price,
            "cost_price": None,
        })
    return rows


def _local_storage_payload(order: dict) -> dict:
    items = []
    for item in order.get("items") or []:
        items.append({
            "name": item.get("name") or order.get("product_hint") or "WhatsApp Order",
            "product_id": item.get("product_id") or order.get("product_id"),
            "sku": item.get("sku") or item.get("product_sku") or item.get("channel_sku_id"),
            "qty": _safe_int(item.get("qty")),
            "unit_price": _safe_float(item.get("unit_price"), _safe_float(item.get("price"))),
            "price": _safe_float(item.get("price"), _safe_float(item.get("unit_price"))),
        })

    total = _order_total({**order, "items": items})
    return {
        "id": order.get("channel_order_id") or order.get("id"),
        "db_order_id": order.get("db_order_id"),
        "customer": order.get("customer_name") or "Customer",
        "phone": order.get("customer_phone") or _phone_from_jid(order.get("chat_jid", "")) or "—",
        "items": items,
        "price": total,
        "total": total,
        "status": "new",
        "channel": "whatsapp",
        "source_message": order.get("message_text", ""),
        "chat_jid": order.get("chat_jid"),
        "payment_link": order.get("payment_link"),
        "payment_link_id": order.get("payment_link_id"),
    }


def _persist_whatsapp_order(order: dict) -> Optional[dict]:
    """
    Sync a confirmed WhatsApp order into the canonical Supabase orders tables.
    The JSON store remains the fast UI/event cache; Supabase is the durable order system.
    """
    order["localStorage_payload"] = _local_storage_payload(order)
    if not _has_supabase_config():
        return None

    try:
        db = get_db()
        now = datetime.now(timezone.utc).isoformat()
        channel_order_id = str(order.get("channel_order_id") or order.get("id") or f"WA-{uuid.uuid4().hex[:8].upper()}")
        order["channel_order_id"] = channel_order_id
        if not order.get("id"):
            order["id"] = channel_order_id

        items = _normalise_wa_items(order, db=db)
        total = _order_total(order)
        chat_jid = order.get("chat_jid", "")
        customer_phone = order.get("customer_phone") or _phone_from_jid(chat_jid)

        row = {
            "channel": "whatsapp",
            "channel_order_id": channel_order_id,
            "status": order.get("status") or "confirmed",
            "payment_mode": order.get("payment_mode") or "prepaid",
            "customer_name": order.get("customer_name") or "Customer",
            "customer_phone": customer_phone,
            "customer_email": order.get("customer_email"),
            "shipping_address": order.get("shipping_address"),
            "pincode": order.get("pincode"),
            "state": order.get("state"),
            "total_amount": total,
            "raw_payload": order,
            "source": order.get("source") or "whatsapp",
            "chat_jid": chat_jid,
            "payment_link": order.get("payment_link"),
            "payment_link_id": order.get("payment_link_id"),
            "updated_at": now,
        }
        if order.get("created_at") or order.get("detected_at"):
            row["created_at"] = order.get("created_at") or order.get("detected_at")

        existing = (
            db.table("orders")
            .select("id")
            .eq("channel", "whatsapp")
            .eq("channel_order_id", channel_order_id)
            .execute()
        )

        if existing.data:
            db_order_id = existing.data[0]["id"]
            db.table("orders").update(row).eq("id", db_order_id).execute()
            db.table("order_items").delete().eq("order_id", db_order_id).execute()
        else:
            result = db.table("orders").insert(row).execute()
            db_order_id = result.data[0]["id"]

        for item in items:
            item["order_id"] = db_order_id
        if items:
            db.table("order_items").insert(items).execute()

        order["db_order_id"] = db_order_id
        order["db_synced_at"] = now
        order["localStorage_payload"] = _local_storage_payload(order)
        return {"id": db_order_id, "channel_order_id": channel_order_id, "items": len(items)}
    except Exception as e:
        order["db_sync_error"] = str(e)
        order["localStorage_payload"] = _local_storage_payload(order)
        logger.error("Failed to sync WhatsApp order %s to database: %s", order.get("id"), e)
        return None


def _update_persisted_whatsapp_order(order: dict, updates: dict) -> None:
    if not _has_supabase_config():
        return
    db_order_id = order.get("db_order_id")
    if not db_order_id:
        _persist_whatsapp_order(order)
        db_order_id = order.get("db_order_id")
    if not db_order_id:
        return
    try:
        db = get_db()
        db.table("orders").update({
            **updates,
            "raw_payload": order,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", db_order_id).execute()
    except Exception as e:
        logger.warning("Could not update persisted WhatsApp order %s: %s", db_order_id, e)


# ── Bridge process state ──────────────────────────────────────────────────────

_bridge_process: Optional[subprocess.Popen] = None  # type: ignore[type-arg]
_qr_code_b64: Optional[str] = None
_wa_connected: bool = False
_bridge_lock = threading.Lock()


# ── Bridge helpers ────────────────────────────────────────────────────────────

def _is_bridge_running() -> bool:
    try:
        httpx.get(f"{BRIDGE_API}/", timeout=3.0)
        return True
    except httpx.ConnectError:
        return False
    except Exception:
        return True  # non-connect error means it's up


def _is_bridge_authenticated() -> bool:
    # First try the Baileys Node bridge /api/status endpoint
    try:
        resp = httpx.get(f"{BRIDGE_API}/api/status", timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("connected"):
                return True
            # Update QR if available from Baileys
            if data.get("qr"):
                global _qr_code_b64, _wa_connected
                _qr_code_b64 = f"qr:{data['qr']}"
                _wa_connected = False
            return False
    except Exception:
        pass
    # Fallback: check whatsmeow SQLite (Go bridge)
    for path in [WHATSAPP_DEVICE_DB, os.path.join(BRIDGE_DIR, "whatsapp.db")]:
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM whatsmeow_device")
            count = cur.fetchone()[0]
            conn.close()
            if count > 0:
                return True
        except Exception:
            pass
    return False


def _qr_data_to_b64(qr_data: str) -> Optional[str]:
    # Return the raw QR data string — frontend renders it using react-qr-code
    # Prefix with "qr:" so frontend knows it's raw data, not a base64 PNG
    return f"qr:{qr_data}" if qr_data else None


def _parse_qr_from_output(line: str) -> Optional[str]:
    line = line.strip()
    line_lower = line.lower()
    for prefix in ("qr code:", "scan this qr code:", "qr:"):
        if line_lower.startswith(prefix):
            data = line[len(prefix):].strip()
            if data:
                return _qr_data_to_b64(data)
    # whatsmeow emits raw QR payload — detect by structure
    if "," in line and "@" in line and len(line) > 20 and not line.startswith("{"):
        return _qr_data_to_b64(line)
    return None


def _bridge_stdout_reader(proc: subprocess.Popen) -> None:  # type: ignore[type-arg]
    global _qr_code_b64, _wa_connected
    try:
        for raw_line in proc.stdout:  # type: ignore[union-attr]
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            logger.debug("[bridge] %s", line)
            # Baileys: "[Bridge] Connected as +91..."
            if any(kw in line.lower() for kw in ("connected as", "logged in", "connected", "already logged in", "client is logged in")):
                _wa_connected = True
                _qr_code_b64 = None
            # Baileys: "[Bridge] QR code ready"
            if "qr code ready" in line.lower():
                # Poll the status endpoint for the actual QR data
                try:
                    resp = httpx.get(f"{BRIDGE_API}/api/status", timeout=3.0)
                    qr_data = resp.json().get("qr")
                    if qr_data:
                        _qr_code_b64 = f"qr:{qr_data}"
                        _wa_connected = False
                except Exception:
                    pass
            qr = _parse_qr_from_output(line)
            if qr:
                _qr_code_b64 = qr
                _wa_connected = False
    except Exception as e:
        logger.debug("Bridge stdout reader exited: %s", e)


def _start_bridge() -> bool:
    global _bridge_process, _wa_connected
    if not os.path.exists(BRIDGE_BINARY):
        logger.warning("Bridge binary not found at %s", BRIDGE_BINARY)
        return False
    if _is_bridge_running():
        if _is_bridge_authenticated():
            _wa_connected = True
        return True
    with _bridge_lock:
        if _is_bridge_running():
            return True
        try:
            proc = subprocess.Popen(
                [BRIDGE_BINARY],
                cwd=BRIDGE_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            _bridge_process = proc
            t = threading.Thread(target=_bridge_stdout_reader, args=(proc,), daemon=True)
            t.start()
            if _is_bridge_authenticated():
                _wa_connected = True
            return True
        except Exception as e:
            logger.error("Failed to start bridge: %s", e)
            return False


# ── SQLite DB helpers ─────────────────────────────────────────────────────────

def _resolve_jid_aliases(phone_jid: str) -> List[str]:
    """
    WhatsApp now stores many contacts under a LID (Linked Device ID) like
    '187758807122129@lid' rather than the phone JID '918337064381@s.whatsapp.net'.
    This function returns ALL JIDs we should scan for a given phone JID.
    """
    jids = [phone_jid]
    phone_number = phone_jid.split("@")[0]
    for db_path in [WHATSAPP_DEVICE_DB, os.path.join(BRIDGE_DIR, "whatsapp.db")]:
        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute("SELECT lid FROM whatsmeow_lid_map WHERE pn = ?", (phone_number,))
            row = cur.fetchone()
            conn.close()
            if row:
                lid_jid = f"{row[0]}@lid"
                if lid_jid not in jids:
                    jids.append(lid_jid)
                break
        except Exception:
            pass
    return jids


def _normalise_message_timestamp(value) -> str:
    if value is None or value == "":
        return datetime.now(timezone.utc).isoformat()
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 10_000_000_000:
            ts = ts / 1000
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    text = str(value)
    if text.isdigit():
        return _normalise_message_timestamp(int(text))
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def _buffer_whatsapp_message(
    chat_jid: str,
    message_id: Optional[str],
    sender: Optional[str],
    text: str,
    timestamp=None,
    is_from_me: bool = False,
    chat_name: Optional[str] = None,
) -> bool:
    """Write a bridge message into the scanner SQLite store. Returns True for a new row."""
    if not chat_jid or not text:
        return False
    msg_id = message_id or str(uuid.uuid4())
    ts = _normalise_message_timestamp(timestamp)
    name = chat_name or sender or chat_jid.split("@")[0]
    inserted = False
    try:
        conn = sqlite3.connect(WHATSAPP_DB_PATH)
        cur = conn.cursor()
        cur.execute(
            "INSERT OR IGNORE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)",
            (chat_jid, name, ts),
        )
        cur.execute(
            "UPDATE chats SET name = COALESCE(NULLIF(?, ''), name), last_message_time = ? WHERE jid = ?",
            (name, ts, chat_jid),
        )
        cur.execute(
            """INSERT OR IGNORE INTO messages (id, chat_jid, sender, content, timestamp, is_from_me)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (msg_id, chat_jid, sender or name, text, ts, 1 if is_from_me else 0),
        )
        inserted = cur.rowcount > 0
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning("Could not buffer WhatsApp message %s for %s: %s", msg_id, chat_jid, e)
    return inserted


def _wa_list_chats(query: Optional[str] = None, limit: int = 50) -> List[dict]:
    """
    Return chats visible to the bridge/device and the local message buffer.
    Filters: no @lid, no @broadcast, no @newsletter.
    Formats Indian phone numbers as +91 XXXXX XXXXX.
    """

    def _fmt_phone(raw: str) -> str:
        raw = raw.split("-")[0]  # strip group timestamp suffix
        if raw.startswith("91") and len(raw) == 12:
            return f"+91 {raw[2:7]} {raw[7:]}"
        if len(raw) == 10 and raw.isdigit():
            return f"+91 {raw[:5]} {raw[5:]}"
        return raw

    rows = []
    seen_jids: set = set()

    def _include(jid: str) -> bool:
        if not jid:
            return False
        blocked = ("@lid", "@broadcast", "@newsletter", "status@broadcast")
        if any(x in jid for x in blocked):
            return False
        return jid.endswith("@s.whatsapp.net") or jid.endswith("@g.us")

    def _append_chat(jid: str, name: str = "", last_message_time: Optional[str] = None) -> None:
        if not _include(jid) or jid in seen_jids:
            return
        phone_raw = jid.replace("@s.whatsapp.net", "").replace("@g.us", "")
        is_group = jid.endswith("@g.us")
        phone_display = "" if is_group else _fmt_phone(phone_raw)
        display_name = name or (f"Group {phone_raw[:12]}" if is_group else phone_display)
        if query:
            q_lower = query.lower()
            haystack = f"{display_name} {phone_display} {jid}".lower()
            if q_lower not in haystack:
                return
        seen_jids.add(jid)
        rows.append({
            "jid": jid,
            "name": display_name,
            "phone": phone_display,
            "is_group": is_group,
            "last_message_time": last_message_time,
        })

    # 1. Contacts from whatsmeow device DB if a Go bridge was used previously.
    try:
        device_conn = sqlite3.connect(WHATSAPP_DEVICE_DB)
        device_conn.row_factory = sqlite3.Row
        dc = device_conn.cursor()
        dc.execute("SELECT their_jid, full_name, push_name, first_name FROM whatsmeow_contacts")
        for r in dc.fetchall():
            _append_chat(r["their_jid"], r["full_name"] or r["push_name"] or r["first_name"] or "")
        device_conn.close()
    except Exception as e:
        logger.debug("Could not load contact names from device DB: %s", e)

    # 2. Baileys bridge in-memory/persisted chat list.
    try:
        resp = httpx.get(f"{BRIDGE_API}/api/chats", params={"q": query or "", "limit": max(limit, 100)}, timeout=4.0)
        if resp.status_code == 200:
            for c in resp.json().get("chats", []):
                _append_chat(c.get("jid", ""), c.get("name", ""), c.get("last_message_time"))
    except Exception as e:
        logger.debug("Could not load chats from bridge API: %s", e)

    # 3. Local buffered chats from live incoming messages and wa_scanner.py.
    try:
        conn = sqlite3.connect(WHATSAPP_DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """SELECT jid, name, last_message_time FROM chats
               ORDER BY COALESCE(last_message_time, '') DESC LIMIT ?""",
            (max(limit, 200),),
        )
        for r in cur.fetchall():
            row = dict(r)
            _append_chat(row.get("jid", ""), row.get("name") or "", row.get("last_message_time"))
        conn.close()
    except Exception as e:
        logger.error("WhatsApp DB chats error: %s", e)

    rows.sort(key=lambda r: (r.get("last_message_time") or "", r["name"].lower()), reverse=True)
    return rows[:limit]


def _wa_list_messages(chat_jid: str, limit: int = 100, after_iso: Optional[str] = None, include_sent: bool = False) -> List[dict]:
    """
    Fetch messages for a chat.
    For DMs: only customer messages (is_from_me=0) unless include_sent=True.
    For groups (@g.us): always include all messages since confirmations come from Raktim himself (is_from_me=1).
    """
    is_group = chat_jid.endswith("@g.us")
    try:
        conn = sqlite3.connect(WHATSAPP_DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        if after_iso:
            if is_group or include_sent:
                cur.execute(
                    """SELECT id, chat_jid, sender, content AS text, timestamp, is_from_me
                       FROM messages WHERE chat_jid = ? AND timestamp > ?
                       ORDER BY timestamp DESC LIMIT ?""",
                    (chat_jid, after_iso, limit),
                )
            else:
                cur.execute(
                    """SELECT id, chat_jid, sender, content AS text, timestamp, is_from_me
                       FROM messages WHERE chat_jid = ? AND timestamp > ? AND is_from_me = 0
                       ORDER BY timestamp DESC LIMIT ?""",
                    (chat_jid, after_iso, limit),
                )
        else:
            if is_group or include_sent:
                cur.execute(
                    """SELECT id, chat_jid, sender, content AS text, timestamp, is_from_me
                       FROM messages WHERE chat_jid = ?
                       ORDER BY timestamp DESC LIMIT ?""",
                    (chat_jid, limit),
                )
            else:
                cur.execute(
                    """SELECT id, chat_jid, sender, content AS text, timestamp, is_from_me
                       FROM messages WHERE chat_jid = ? AND is_from_me = 0
                       ORDER BY timestamp DESC LIMIT ?""",
                    (chat_jid, limit),
                )
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return rows
    except Exception as e:
        logger.error("WhatsApp DB messages error (%s): %s", chat_jid, e)
        return []


def _wa_list_all_messages(chat_jid: str, limit: int = 10) -> List[dict]:
    """Read last N messages (both directions) across all JID aliases for confirmation detection."""
    all_rows: List[dict] = []
    for jid in _resolve_jid_aliases(chat_jid):
        try:
            conn = sqlite3.connect(WHATSAPP_DB_PATH)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(
                """SELECT id, chat_jid, sender, content AS text, timestamp, is_from_me
                   FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ?""",
                (jid, limit),
            )
            all_rows.extend(dict(r) for r in cur.fetchall())
            conn.close()
        except Exception as e:
            logger.error("WhatsApp DB all-messages error (%s): %s", jid, e)
    # Sort by timestamp descending and return top N
    all_rows.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return all_rows[:limit]


# ── Intent detection ──────────────────────────────────────────────────────────

INTENT_KEYWORDS = [
    "want", "need", "interested", "can i get", "send me", "order", "book",
    "how much", "price", "available", "stock", "buy", "purchase", "do you have",
    "i'll take", "i want", "looking for", "get me", "want to buy",
]

CONFIRMATION_KEYWORDS = [
    "yes", "confirm", "ok", "confirmed", "yeah", "yep", "sure", "proceed",
    "हाँ", "हा", "हां", "ji", "ji han", "ji ha", "okay", "buy", "order",
    "place order", "i'll take", "i want", "done", "agreed", "go ahead",
]

_QTY_PATTERNS = [
    r'(\d+)\s*(?:pieces?|pcs?|units?|qty|nos?|x)',
    r'[×xX]\s*(\d+)',
    r'(?:qty|quantity)\s*[:\-]?\s*(\d+)',
    r'\b(\d+)\s+(?:pieces?|pcs?|units?)\b',
]
_PRICE_PATTERN = r'(?:₹|Rs\.?|INR)\s*(\d[\d,]*(?:\.\d{1,2})?)'


def _match_product(text_lower: str, products: List[dict]) -> Optional[dict]:
    best: Optional[dict] = None
    best_score = 0.0
    for p in products:
        name_lower = p.get("name", "").lower()
        sku = p.get("sku", "").lower()
        if name_lower and name_lower in text_lower:
            return p
        if sku and sku in text_lower:
            return p
        words = [w for w in name_lower.split() if len(w) > 3]
        if not words:
            continue
        score = sum(1 for w in words if w in text_lower) / len(words)
        if score > 0.5 and score > best_score:
            best_score = score
            best = p
    return best


def _guess_product_name(text: str) -> Optional[str]:
    clean = text
    for kw in ("i want to order", "i want", "i need", "can i get", "send me", "order", "book", "buy", "purchase"):
        clean = re.sub(re.escape(kw), "", clean, flags=re.IGNORECASE).strip()
    clean = re.sub(r"^(a|an|the|one|1)\s+", "", clean, flags=re.IGNORECASE).strip()
    chunk = re.split(r"[,.\?!]", clean)[0].strip()
    chunk = re.sub(r"\s*(please|pls|kindly|asap)$", "", chunk, flags=re.IGNORECASE).strip()
    return chunk if len(chunk) > 2 else None


def _detect_order_intent(message_text: str, products: List[dict]) -> Optional[dict]:
    text_lower = message_text.strip().lower()
    found_kw = [kw for kw in INTENT_KEYWORDS if kw in text_lower]
    
    # Try line-by-line parsing for structured cart checkout text
    lines = [l.strip() for l in message_text.split('\n') if l.strip()]
    matched_items = []
    
    if len(lines) > 1:
        for line in lines:
            line_lower = line.lower()
            matched = _match_product(line_lower, products)
            if matched:
                qty = 1
                for pattern in _QTY_PATTERNS:
                    m = re.search(pattern, line_lower, re.IGNORECASE)
                    if m:
                        try:
                            qty = int(m.group(1))
                        except (ValueError, IndexError):
                            pass
                        break
                matched_items.append({
                    "product": matched,
                    "qty": qty
                })
                
    # If no line-by-line matches, search for multiple product mentions in a single message
    if not matched_items:
        for p in products:
            p_name = p.get("name", "").lower()
            p_sku = p.get("sku", "").lower()
            if (p_name and p_name in text_lower) or (p_sku and p_sku in text_lower):
                start_idx = text_lower.find(p_name) if p_name in text_lower else text_lower.find(p_sku)
                window = text_lower[max(0, start_idx-15):min(len(text_lower), start_idx+len(p_name)+15)]
                qty = 1
                for pattern in _QTY_PATTERNS:
                    m = re.search(pattern, window, re.IGNORECASE)
                    if m:
                        try:
                            qty = int(m.group(1))
                        except (ValueError, IndexError):
                            pass
                        break
                if not any(item["product"].get("id") == p.get("id") for item in matched_items):
                    matched_items.append({
                        "product": p,
                        "qty": qty
                    })

    if not matched_items:
        # Product name alone counts as enquiry
        matched = _match_product(text_lower, products)
        if not found_kw and matched:
            found_kw = ["product_name_match"]
            
        if not found_kw:
            return None
            
        if not matched:
            guessed = _guess_product_name(message_text)
            if not guessed:
                return None
            matched = {"id": None, "name": guessed, "sku": None, "price": None, "stock": None}
            
        qty = 1
        for pattern in _QTY_PATTERNS:
            m = re.search(pattern, text_lower, re.IGNORECASE)
            if m:
                try:
                    qty = int(m.group(1))
                except (ValueError, IndexError):
                    pass
                break
                
        price_hint = matched.get("price")
        pm = re.search(_PRICE_PATTERN, message_text)
        if pm:
            price_hint = float(pm.group(1).replace(",", ""))
            
        confidence = min(0.4 + len(found_kw) * 0.1 + (0.4 if matched.get("id") else 0.1), 0.99)
        
        return {
            "matched_product": matched,
            "product_hint": matched.get("name"),
            "product_id": matched.get("id"),
            "product_sku": matched.get("sku"),
            "catalog_price": matched.get("price"),
            "in_catalog": matched.get("id") is not None,
            "qty": qty,
            "price_hint": price_hint,
            "confidence": round(confidence, 2),
            "items": [{
                "name": matched.get("name"),
                "product_id": matched.get("id"),
                "sku": matched.get("sku"),
                "qty": qty,
                "price": matched.get("price") or 0.0,
            }]
        }

    # Aggregate matched items
    items_list = []
    total_price = 0.0
    for item in matched_items:
        p = item["product"]
        qty = item["qty"]
        price = float(p.get("price") or 0.0)
        items_list.append({
            "name": p.get("name"),
            "product_id": p.get("id"),
            "sku": p.get("sku"),
            "qty": qty,
            "price": price
        })
        total_price += price * qty
        
    first_item = matched_items[0]
    confidence = min(0.5 + len(matched_items) * 0.15 + (0.2 if found_kw else 0.0), 0.99)
    
    return {
        "matched_product": first_item["product"],
        "product_hint": first_item["product"].get("name"),
        "product_id": first_item["product"].get("id"),
        "product_sku": first_item["product"].get("sku"),
        "catalog_price": first_item["product"].get("price"),
        "in_catalog": True,
        "qty": sum(item["qty"] for item in matched_items),
        "price_hint": first_item["product"].get("price"),
        "confidence": round(confidence, 2),
        "items": items_list,
        "total_price": total_price
    }



# ── Product catalog ───────────────────────────────────────────────────────────

def _get_products() -> List[dict]:
    if _synced_products:
        return _synced_products
    try:
        db = get_db()
        result = db.table("products").select("id, name, skus(sku, selling_price, mrp, inventory(qty_available, qty_on_hand))").limit(200).execute()
        if result.data:
            products = []
            for row in result.data:
                sku_rows = row.get("skus") or []
                sku_row = sku_rows[0] if isinstance(sku_rows, list) and sku_rows else {}
                inv_rows = sku_row.get("inventory") or []
                inv_row = inv_rows[0] if isinstance(inv_rows, list) and inv_rows else {}
                products.append({
                    "id": row.get("id"),
                    "name": row.get("name", ""),
                    "sku": sku_row.get("sku"),
                    "price": _safe_float(sku_row.get("selling_price"), _safe_float(sku_row.get("mrp"))),
                    "stock": _safe_nonnegative_int(inv_row.get("qty_available"), _safe_nonnegative_int(inv_row.get("qty_on_hand"), 0)),
                })
            return products
    except Exception:
        pass
    try:
        db = get_db()
        result = db.table("skus").select("sku, name, selling_price, mrp").limit(200).execute()
        if result.data:
            return [
                {
                    "id": r.get("sku"),
                    "name": r.get("name", ""),
                    "sku": r.get("sku"),
                    "price": _safe_float(r.get("selling_price"), _safe_float(r.get("mrp"))),
                    "stock": 99,
                }
                for r in result.data
            ]
    except Exception:
        pass
    return []


def _get_product_by_id(product_id: str) -> Optional[dict]:
    return next((p for p in _get_products() if p.get("id") == product_id), None)


def _get_product_by_name(name: str) -> Optional[dict]:
    if not name:
        return None
    name_lower = name.lower()
    return next((p for p in _get_products() if p.get("name", "").lower() == name_lower), None)


def _deduct_stock(product_id: str, qty: int) -> None:
    if not product_id or not _has_supabase_config():
        return
    try:
        db = get_db()
        product = _get_product_by_id(product_id)
        sku = product.get("sku") if product else None
        if not sku:
            sku_row = db.table("skus").select("sku").eq("product_id", product_id).limit(1).execute()
            if sku_row.data:
                sku = sku_row.data[0].get("sku")
        if sku:
            result = db.table("inventory").select("qty_on_hand").eq("sku", sku).maybe_single().execute()
            if result.data:
                current = _safe_nonnegative_int(result.data.get("qty_on_hand"))
                db.table("inventory").update({"qty_on_hand": max(0, current - _safe_int(qty))}).eq("sku", sku).execute()
    except Exception as e:
        logger.debug("Could not deduct stock for %s: %s", product_id, e)


# ── Draft reply builder ───────────────────────────────────────────────────────

def _create_draft_reply(detection: dict) -> dict:
    items = detection.get("items")
    customer_name = detection.get("customer_name", "there")
    
    if items and len(items) > 1:
        # Multiple items
        item_lines = []
        total = 0.0
        available_count = 0
        
        for item in items:
            p_id = item.get("product_id")
            p = _get_product_by_id(p_id) if p_id else None
            stock = p.get("stock", 99) if p else 0
            qty = item.get("qty", 1)
            price = item.get("price") or 0.0
            
            if stock > 0:
                available_count += 1
                item_lines.append(f"• *{item['name']}* (Qty: {qty}) — ₹{price * qty}")
                total += price * qty
            else:
                item_lines.append(f"• *{item['name']}* (Qty: {qty}) — _Out of stock_ ❌")
                
        if available_count > 0:
            msg = (
                f"Hi {customer_name}! \U0001f44b\n\n"
                f"We noticed you're interested in these items:\n"
                f"{chr(10).join(item_lines)}\n\n"
                f"Reply *YES* to confirm your order.\n"
                f"Total: *₹{total}*"
            )
            available_items = []
            for item in items:
                product = _get_product_by_id(item.get("product_id")) if item.get("product_id") else None
                if product and product.get("stock", 0) > 0:
                    available_items.append(item)
            _conversation_states[detection["chat_jid"]] = {
                "state": "waiting_confirm",
                "detection_id": detection["id"],
                "items": available_items,
                "total": total,
                "sent_at": None,
                "qty": sum(item.get("qty", 1) for item in items),
                "price": total, # Legacy compat
                "product_name": ", ".join(item.get("name") for item in items)
            }
        else:
            msg = (
                f"Hi {customer_name}! \U0001f44b\n\n"
                f"Thank you for your interest.\n\n"
                f"❌ Unfortunately, the requested items are currently out of stock."
            )
            
        return {
            "id": str(uuid.uuid4()),
            "detection_id": detection["id"],
            "chat_jid": detection["chat_jid"],
            "customer_name": customer_name,
            "product_name": ", ".join(item.get("name") for item in items),
            "product_id": items[0].get("product_id") if items else None,
            "product_available": available_count > 0,
            "product_price": total,
            "stock_qty": available_count,
            "catalog_price": total,
            "qty": sum(item.get("qty", 1) for item in items),
            "draft_message": msg,
            "message_text": msg,
            "status": "draft",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    else:
        # Legacy/Single product fallback
        product = (
            _get_product_by_id(detection.get("product_id") or "")
            or _get_product_by_name(detection.get("product_hint") or "")
        )
        stock = product.get("stock", product.get("quantity", 99)) if product else 0
        available = product is not None and stock > 0
        qty = detection.get("qty", 1)

        if available:
            price = product["price"]
            msg = (
                f"Hi {customer_name}! \U0001f44b\n\n"
                f"We noticed you're interested in *{product['name']}*.\n\n"
                f"✅ Good news! It's available at *₹{price}*.\n\n"
                f"Reply *YES* to confirm your order of {qty} unit(s).\n"
                f"Total: *₹{price * qty}*"
            )
            _conversation_states[detection["chat_jid"]] = {
                "state": "waiting_confirm",
                "detection_id": detection["id"],
                "product_name": product["name"],
                "product_id": product.get("id"),
                "qty": qty,
                "price": price,
                "total": price * qty,
                "items": [{"name": product["name"], "product_id": product.get("id"), "qty": qty, "price": price}],
                "sent_at": None,
            }
        else:
            product_name = detection.get("product_hint", "the product")
            msg = (
                f"Hi {customer_name}! \U0001f44b\n\n"
                f"Thank you for your interest in *{product_name}*.\n\n"
                f"❌ Unfortunately, this item is currently out of stock.\n\n"
                f"We'll notify you as soon as it's back!"
            )

        return {
            "id": str(uuid.uuid4()),
            "detection_id": detection["id"],
            "chat_jid": detection["chat_jid"],
            "customer_name": customer_name,
            "product_name": detection.get("product_hint", ""),
            "product_id": detection.get("product_id"),
            "product_available": available,
            "product_price": product.get("price") if product else None,
            "stock_qty": stock,
            "catalog_price": product.get("price") if product else None,
            "qty": qty,
            "draft_message": msg,
            "message_text": msg,
            "status": "draft",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }


# ── Automated Razorpay payment links ──────────────────────────────────────────

def _generate_and_send_payment_link(order: dict) -> None:
    try:
        from .payments import _rz_auth, RAZORPAY_BASE

        _persist_whatsapp_order(order)
        if _has_supabase_config() and not order.get("db_order_id"):
            logger.warning("Skipping payment link for %s because database sync did not complete", order.get("id"))
            return
        
        amount = float(order.get("total") or order.get("price", 0.0))
        if amount <= 0:
            return
            
        customer_name = order.get("customer_name", "Customer")
        chat_jid = order.get("chat_jid")
        phone = chat_jid.split("@")[0].split("-")[0] if chat_jid else ""
        order_id = order.get("db_order_id") or order.get("id")
        channel_order_id = order.get("channel_order_id") or order.get("id")
        
        # Fallback check for Razorpay credentials
        try:
            auth = _rz_auth()
            has_credentials = True
        except Exception:
            has_credentials = False

        if not has_credentials:
            # Demo mode / missing credentials fallback
            short_url = f"https://rzp.io/i/mock-{order_id}"
            order["payment_link"] = short_url
            order["localStorage_payload"] = _local_storage_payload(order)
            _persist_all()
            _update_persisted_whatsapp_order(order, {"payment_link": short_url})
            
            wa_message = (
                f"Thank you for confirming your order, {customer_name.split()[0]}! 🎉\n\n"
                f"[Demo Mode - Razorpay Credentials Not Configured]\n\n"
                f"Here's your mock payment link:\n\n"
                f"💳 *Amount:* ₹{amount:,.0f}\n"
                f"🔗 *Pay here:* {short_url}\n\n"
                f"Once payment is completed, your order will be shipped. Thank you! 🙏"
            )
            
            if _is_bridge_running():
                httpx.post(
                    f"{BRIDGE_API}/api/send",
                    json={"recipient": chat_jid, "message": wa_message},
                    timeout=10,
                )
            return

        # Real Razorpay link generation
        amount_paise = int(amount * 100)
        norm_phone = phone.replace(" ", "").replace("-", "")
        if not norm_phone.startswith("+"):
            if norm_phone.startswith("91") and len(norm_phone) == 12:
                norm_phone = "+" + norm_phone
            elif len(norm_phone) == 10:
                norm_phone = "+91" + norm_phone
            else:
                norm_phone = "+91" + norm_phone

        payload = {
            "amount": amount_paise,
            "currency": "INR",
            "accept_partial": False,
            "description": f"Payment for order {order_id}",
            "customer": {
                "name": customer_name,
                "contact": norm_phone,
                "email": "noreply@d2cflow.in",
            },
            "notify": {
                "sms": True,
                "email": False,
            },
            "reminder_enable": True,
            "notes": {
                "order_id": order_id,
                "channel_order_id": channel_order_id,
                "source": "whatsapp_bot",
            },
            "callback_url": f"{get_settings().app_base_url}/api/payments/webhook",
            "callback_method": "get",
        }

        with httpx.Client(timeout=20) as client:
            resp = client.post(
                f"{RAZORPAY_BASE}/payment_links",
                auth=auth,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        short_url = data.get("short_url")
        if not short_url:
            return

        order["payment_link"] = short_url
        order["payment_link_id"] = data.get("id")
        order["localStorage_payload"] = _local_storage_payload(order)
        _persist_all()
        _update_persisted_whatsapp_order(order, {
            "payment_link": short_url,
            "payment_link_id": data.get("id"),
        })

        wa_message = (
            f"Thank you for confirming your order, {customer_name.split()[0]}! 🎉\n\n"
            f"Here's your secure payment link powered by Razorpay:\n\n"
            f"💳 *Amount:* ₹{amount:,.0f}\n"
            f"🔗 *Pay here:* {short_url}\n\n"
            f"Once payment is completed, your order will be shipped. Thank you! 🙏"
        )

        if _is_bridge_running():
            httpx.post(
                f"{BRIDGE_API}/api/send",
                json={"recipient": chat_jid, "message": wa_message},
                timeout=10,
            )
            logger.info("Auto-sent Razorpay link to %s", chat_jid)

    except Exception as e:
        logger.error("Failed to auto-generate/send Razorpay payment link: %s", e)


# ── Confirmed order creator ───────────────────────────────────────────────────

def _create_confirmed_order(chat_jid: str) -> Optional[dict]:
    state = _conversation_states.get(chat_jid)
    if not state or state.get("state") != "waiting_confirm":
        return None

    chat = next((c for c in _monitored_chats if c["chat_jid"] == chat_jid), None)
    customer_name = (chat or {}).get("customer_name", "Customer")
    
    # Multiple items support
    items = state.get("items")
    if items:
        for item in items:
            p_id = item.get("product_id")
            if p_id:
                _deduct_stock(p_id, item.get("qty", 1))
        qty = sum(item.get("qty", 1) for item in items)
        price = state.get("price") or 0.0
        product_name = state.get("product_name", "WhatsApp Order")
    else:
        qty = state.get("qty", 1)
        price = state.get("price") or 0.0
        product_name = state.get("product_name", "WhatsApp Order")
        product_id = state.get("product_id")
        if product_id:
            _deduct_stock(product_id, qty)
        items = [{"name": product_name, "product_id": product_id, "qty": qty, "price": price}]

    order = {
        "id": f"WA-{uuid.uuid4().hex[:8].upper()}",
        "channel": "whatsapp",
        "chat_jid": chat_jid,
        "customer_name": customer_name,
        "customer_phone": chat_jid.split("@")[0].split("-")[0],
        "message_text": f"Customer confirmed order for {product_name}",
        "product_hint": product_name,
        "product_id": items[0].get("product_id") if items else None,
        "qty": qty,
        "price": price / qty if qty else price,
        "total": price,
        "catalog_price": price / qty if qty else price,
        "items": items,
        "confidence": 1.0,
        "status": "confirmed",
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
        "message_id": str(uuid.uuid4()),
        "source": "whatsapp_confirmation",
    }
    _detected_orders.append(order)
    _conversation_states[chat_jid]["state"] = "idle"
    _persist_whatsapp_order(order)
    _persist_all()

    # Generate and send Razorpay payment link automatically
    _generate_and_send_payment_link(order)

    return {
        "order": order,
        "localStorage_payload": _local_storage_payload(order),
    }


# ── Core scan logic ───────────────────────────────────────────────────────────

def _run_scan_and_draft(chat_jid: Optional[str] = None) -> dict:
    products = _get_products()
    new_detections = 0
    new_drafts = 0
    existing_msg_ids = {o.get("message_id") for o in _detected_orders if o.get("message_id")}
    existing_detection_ids = {r["detection_id"] for r in _drafted_replies}

    chats_to_scan = (
        [c for c in _monitored_chats if c["chat_jid"] == chat_jid]
        if chat_jid else list(_monitored_chats)
    )
    total_messages = 0

    for chat in chats_to_scan:
        jid = chat["chat_jid"]

        # Skip only if there's a confirmed order AFTER the current broadcast was sent
        # (allows same contact to place new orders after fresh broadcasts)
        state = _conversation_states.get(jid, {})
        sent_at_str = state.get("sent_at", "")
        if sent_at_str:
            try:
                sent_dt = datetime.fromisoformat(sent_at_str.replace("Z", "+00:00"))
                already_confirmed = any(
                    o.get("chat_jid") == jid and o.get("status") == "confirmed"
                    and datetime.fromisoformat(str(o.get("confirmed_at","")).replace("Z","+00:00")) >= sent_dt
                    for o in _detected_orders
                    if o.get("confirmed_at")
                )
                if already_confirmed:
                    continue
            except Exception:
                pass

        cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)
        last_scanned_str = chat.get("last_scanned")

        # If we're waiting for a YES, look back to when we sent the offer (not just last scan)
        state_for_jid = _conversation_states.get(jid, {})
        waiting_sent_at = state_for_jid.get("sent_at") if state_for_jid.get("state") == "waiting_confirm" else None

        if last_scanned_str:
            try:
                last_dt = datetime.fromisoformat(last_scanned_str.replace("Z", "+00:00"))
                after_dt = min(last_dt, cutoff_24h)
            except Exception:
                after_dt = cutoff_24h
        else:
            after_dt = datetime.now(timezone.utc) - timedelta(days=7)

        # Also check from when we sent the offer if waiting — customer may have replied before last scan
        if waiting_sent_at:
            try:
                sent_dt = datetime.fromisoformat(waiting_sent_at.replace("Z", "+00:00"))
                after_dt = min(after_dt, sent_dt)  # go back as far as the sent time
            except Exception:
                pass

        # Resolve LID aliases — WhatsApp may store the contact under a different JID
        jids_to_scan = _resolve_jid_aliases(jid)

        messages = []
        for scan_jid in jids_to_scan:
            messages.extend(_wa_list_messages(scan_jid, limit=500, after_iso=after_dt.isoformat()))
        total_messages += len(messages)

        for msg in messages:
            msg_id = msg.get("id")
            if msg_id and msg_id in existing_msg_ids:
                continue
            text = msg.get("text") or ""
            if not text:
                continue

            text_lower = text.lower()
            if any(kw in text_lower for kw in CONFIRMATION_KEYWORDS):
                _check_for_customer_confirmation(jid, text, msg)

            intent = _detect_order_intent(text, products)
            if not intent:
                continue

            customer_name = chat.get("customer_name") or msg.get("sender") or "Unknown"
            detection = {
                "id": str(uuid.uuid4()),
                "chat_jid": jid,
                "customer_name": customer_name,
                "message_text": text,
                "product_hint": intent["product_hint"],
                "product_id": intent["product_id"],
                "product_sku": intent["product_sku"],
                "catalog_price": intent["catalog_price"],
                "in_catalog": intent["in_catalog"],
                "qty": intent["qty"],
                "price": intent["price_hint"],
                "confidence": intent["confidence"],
                "status": "pending",
                "detected_at": datetime.now(timezone.utc).isoformat(),
                "message_id": msg_id,
                "message_timestamp": msg.get("timestamp"),
                "sender": msg.get("sender"),
            }
            _detected_orders.append(detection)
            if msg_id:
                existing_msg_ids.add(msg_id)
            new_detections += 1
            chat["order_count"] = chat.get("order_count", 0) + 1

            if detection["id"] not in existing_detection_ids:
                draft = _create_draft_reply(detection)
                _drafted_replies.append(draft)
                existing_detection_ids.add(detection["id"])
                new_drafts += 1

    now = datetime.now(timezone.utc).isoformat()
    for c in chats_to_scan:
        c["last_scanned"] = now
    _save_json(_CHATS_FILE, _monitored_chats)
    _persist_all()

    return {
        "scanned_chats": len(chats_to_scan),
        "messages_read": total_messages,
        "new_detections": new_detections,
        "new_drafts": new_drafts,
        "total_pending": sum(1 for o in _detected_orders if o["status"] == "pending"),
        "source": "real_whatsapp_db",
    }


def _check_for_customer_confirmation(chat_jid: str, text: str, msg: dict) -> None:
    """
    Called whenever a YES/confirm message is detected in a monitored chat.
    Flow: customer asks for product → system offers it with price → customer says YES → order created.
    We look for a draft/sent reply for this chat (meaning we already offered the product),
    then directly create a confirmed order using the product info stored in _conversation_states.
    """
    state = _conversation_states.get(chat_jid, {})

    # Parse the message timestamp
    msg_ts_str = str(msg.get("timestamp", "")).replace(" ", "T")
    try:
        msg_dt = datetime.fromisoformat(msg_ts_str)
        if msg_dt.tzinfo is None:
            msg_dt = msg_dt.replace(tzinfo=timezone.utc)
    except Exception:
        msg_dt = datetime.now(timezone.utc)

    # Don't re-trigger if we already created a confirmed order for a message at this exact timestamp
    already_confirmed = any(
        o.get("chat_jid") == chat_jid
        and o.get("status") == "confirmed"
        and o.get("confirmation_msg_ts") == msg_dt.isoformat()
        for o in _detected_orders
    )
    if already_confirmed:
        return

    # Need either a draft/sent reply (inbound flow) or a waiting_confirm state (CRM flow)
    has_offered = (
        state.get("state") in ("waiting_confirm",)
        or any(r["chat_jid"] == chat_jid and r["status"] in ("draft", "sent") for r in _drafted_replies)
    )
    if not has_offered:
        return

    # Get product info from state (set when draft was created) or from latest sent reply
    product_name = state.get("product_name", "")
    product_id = state.get("product_id", "")
    price = state.get("price", 0.0)
    qty = state.get("qty", 1)
    items = state.get("items")

    # Fall back to latest draft/sent reply if state doesn't have product info
    if not product_name and not items:
        replies = [r for r in _drafted_replies if r["chat_jid"] == chat_jid]
        if replies:
            latest = sorted(replies, key=lambda r: r.get("created_at", ""), reverse=True)[0]
            product_name = latest.get("product_name", "")
            product_id = latest.get("product_id") or ""
            price = latest.get("catalog_price") or latest.get("product_price") or 0.0
            qty = latest.get("qty", 1)

    chat = next((c for c in _monitored_chats if c["chat_jid"] == chat_jid), None)
    customer_name = (chat or {}).get("customer_name", "Customer")

    if items:
        for item in items:
            p_id = item.get("product_id")
            if p_id:
                _deduct_stock(p_id, item.get("qty", 1))
        total = state.get("total") or price
        product_hint = product_name or ", ".join(item.get("name") for item in items)
    else:
        if product_id:
            _deduct_stock(product_id, qty)
        items = [{"name": product_name or "WhatsApp Order", "product_id": product_id, "qty": qty, "price": price}]
        total = price * qty
        product_hint = product_name or "WhatsApp Order"

    order = {
        "id": f"WA-{uuid.uuid4().hex[:8].upper()}",
        "channel": "whatsapp",
        "chat_jid": chat_jid,
        "customer_name": customer_name,
        "customer_phone": chat_jid.split("@")[0].split("-")[0],
        "message_text": text,
        "product_hint": product_hint,
        "product_id": product_id or (items[0].get("product_id") if items else None),
        "items": items,
        "qty": qty,
        "price": price / qty if qty and not items else price,
        "total": total,
        "catalog_price": price / qty if qty and not items else price,
        "confidence": 1.0,
        "status": "confirmed",
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
        "confirmation_msg_ts": msg_dt.isoformat(),
        "message_id": msg.get("id", str(uuid.uuid4())),
        "source": "whatsapp_inbound",
        "notes": f"Customer confirmed: '{text}'",
    }
    _detected_orders.append(order)

    # Reset conversation state
    if state:
        _conversation_states[chat_jid]["state"] = "idle"

    _persist_whatsapp_order(order)
    _persist_all()
    logger.info("Inbound confirmation: order %s created for %s product=%s", order["id"], customer_name, product_hint)
    
    # Auto-generate and send payment link
    _generate_and_send_payment_link(order)



def _run_check_confirmations() -> dict:
    """
    Check each pending broadcast for a YES reply with a NEW timestamp.
    Key insight: if msg timestamp > last_confirmed_message_ts (or > sent_at for first YES),
    it's a brand-new confirmation — create an order and record this timestamp.
    This way multiple broadcasts to the same contact are handled independently.
    """
    checked = 0
    confirmed_count = 0
    orders_created = []

    for broadcast in _pending_broadcasts:
        if broadcast.get("confirmed"):
            continue  # already confirmed

        jid = broadcast["jid"]
        sent_at_str = broadcast.get("sent_at", "")
        last_ts_str = broadcast.get("last_confirmed_message_ts")

        # Parse cutoff: use last_confirmed_message_ts if set, else sent_at
        cutoff_str = last_ts_str if last_ts_str else sent_at_str
        try:
            cutoff_dt = datetime.fromisoformat(cutoff_str.replace("Z", "+00:00")) if cutoff_str else None
        except Exception:
            cutoff_dt = None

        checked += 1
        is_group = jid.endswith("@g.us")

        for msg in _wa_list_all_messages(jid, limit=50):
            # Groups: YES is sent by Raktim himself (is_from_me=1); DMs: customer replies (is_from_me=0)
            if is_group:
                if msg.get("is_from_me", 0) != 1:
                    continue  # groups: only our own sent messages count as replies
            else:
                if msg.get("is_from_me", 1) == 1:
                    continue  # DMs: skip our own messages

            # Parse message timestamp
            try:
                raw_ts = str(msg.get("timestamp", "")).replace(" ", "T")
                msg_dt = datetime.fromisoformat(raw_ts)
                if msg_dt.tzinfo is None:
                    msg_dt = msg_dt.replace(tzinfo=timezone.utc)
            except Exception:
                continue

            # Must be strictly NEWER than cutoff to be a new order
            if cutoff_dt and msg_dt <= cutoff_dt:
                continue

            # Skip very old messages (>7 days) as safety
            if msg_dt < datetime.now(timezone.utc) - timedelta(days=7):
                continue

            text = (msg.get("text") or "").strip().lower()
            if any(kw in text for kw in CONFIRMATION_KEYWORDS):
                # This is a new YES — create order using broadcast product info
                result = _create_confirmed_order_from_broadcast(jid, broadcast)
                if result:
                    confirmed_count += 1
                    orders_created.append(result)
                    # Mark this broadcast confirmed and record the message timestamp
                    broadcast["confirmed"] = True
                    broadcast["last_confirmed_message_ts"] = msg_dt.isoformat()
                    broadcast["confirmed_at"] = datetime.now(timezone.utc).isoformat()
                    _persist_all()
                    logger.info("New YES detected for broadcast %s jid=%s msg_ts=%s", broadcast["id"], jid, msg_dt.isoformat())
                break

    return {"checked": checked, "confirmed": confirmed_count, "orders_created": orders_created}


def _create_confirmed_order_from_broadcast(jid: str, broadcast: dict) -> Optional[dict]:
    """Create a confirmed order from a pending broadcast entry."""
    chat = next((c for c in _monitored_chats if c["chat_jid"] == jid), None)
    customer_name = broadcast.get("customer_name") or (chat.get("customer_name") if chat else jid)
    product_name = broadcast.get("product_name", "Unknown Product")
    product_id = broadcast.get("product_id", "")
    price = broadcast.get("price", 0.0)
    qty = broadcast.get("qty", 1)
    product = _get_product_by_id(product_id) if product_id else None
    sku = product.get("sku") if product else broadcast.get("sku")
    if product and not price:
        price = product.get("price", 0.0)

    now_iso = datetime.now(timezone.utc).isoformat()
    order = {
        "id": f"WA-{uuid.uuid4().hex[:8].upper()}",
        "channel": "whatsapp",
        "customer_name": customer_name,
        "customer_phone": jid.split("@")[0].split("-")[0],
        "chat_jid": jid,
        "product_hint": product_name,
        "product_id": product_id,
        "qty": qty,
        "price": price,
        "catalog_price": price,
        "items": [{"name": product_name, "product_id": product_id, "sku": sku, "qty": qty, "price": price}],
        "total": price * qty,
        "confidence": 1.0,
        "status": "confirmed",
        "detected_at": now_iso,
        "confirmed_at": now_iso,
        "created_at": now_iso,
        "broadcast_id": broadcast.get("id", ""),
        "source": "crm_broadcast",
        "notes": "Auto-confirmed via WhatsApp YES reply",
    }
    _detected_orders.append(order)
    _persist_whatsapp_order(order)
    _persist_all()
    logger.info("Order created from broadcast: %s customer=%s product=%s", order["id"], customer_name, product_name)
    
    # Auto-generate and send payment link
    _generate_and_send_payment_link(order)
    
    return order


def _scan_self_sent_confirmations() -> dict:
    """
    Detect orders from broadcasts sent DIRECTLY via WhatsApp (not via CRM tool).
    Pattern: Raktim sends offer message (is_from_me=1) → then sends YES/BUY (is_from_me=1).
    Works for both groups and DMs. Extracts product+price from the offer message text.
    """
    created = 0
    orders_created = []

    # Get all confirmed orders timestamps per JID to avoid re-creating
    confirmed_ts_by_jid: dict = {}
    for o in _detected_orders:
        if o.get("status") == "confirmed":
            jid = o.get("chat_jid", "")
            ts = o.get("confirmation_msg_ts") or o.get("confirmed_at") or ""
            if jid not in confirmed_ts_by_jid or ts > confirmed_ts_by_jid[jid]:
                confirmed_ts_by_jid[jid] = ts

    for chat in _monitored_chats:
        jid = chat["chat_jid"]
        # Get recent messages from both directions — include sent messages
        msgs = []
        for alias_jid in _resolve_jid_aliases(jid):
            try:
                conn = sqlite3.connect(WHATSAPP_DB_PATH)
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                # Look back 48 hours
                cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat().replace("+00:00", "")
                cur.execute(
                    """SELECT id, chat_jid, sender, content AS text, timestamp, is_from_me
                       FROM messages WHERE chat_jid = ? AND timestamp > ?
                       ORDER BY timestamp ASC""",
                    (alias_jid, cutoff),
                )
                msgs.extend(dict(r) for r in cur.fetchall())
                conn.close()
            except Exception as e:
                logger.error("_scan_self_sent_confirmations DB error (%s): %s", alias_jid, e)

        if not msgs:
            continue

        # Walk messages looking for: sent offer → sent YES (within next ~5 messages or 10 minutes)
        for i, msg in enumerate(msgs):
            if msg.get("is_from_me") != 1:
                continue
            text = (msg.get("text") or "").strip()
            if not text:
                continue

            # Is this an offer message? Look for price pattern (₹XXXX or Rs.XXXX)
            price_match = re.search(r'[₹Rs\.]+\s*(\d[\d,]*)', text)
            if not price_match:
                continue

            try:
                price = float(price_match.group(1).replace(",", ""))
            except Exception:
                continue

            # Parse offer timestamp
            try:
                offer_ts_raw = str(msg.get("timestamp", "")).replace(" ", "T")
                offer_dt = datetime.fromisoformat(offer_ts_raw)
                if offer_dt.tzinfo is None:
                    offer_dt = offer_dt.replace(tzinfo=timezone.utc)
            except Exception:
                continue

            # Look at next 10 messages or within 10 minutes for YES/BUY
            for j in range(i + 1, min(i + 15, len(msgs))):
                follow = msgs[j]
                if follow.get("is_from_me") != 1:
                    continue
                follow_text = (follow.get("text") or "").strip().lower()
                if not any(kw in follow_text for kw in CONFIRMATION_KEYWORDS):
                    continue

                # Parse YES timestamp
                try:
                    yes_ts_raw = str(follow.get("timestamp", "")).replace(" ", "T")
                    yes_dt = datetime.fromisoformat(yes_ts_raw)
                    if yes_dt.tzinfo is None:
                        yes_dt = yes_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    continue

                # Must be within 30 minutes of offer
                if (yes_dt - offer_dt).total_seconds() > 1800:
                    break

                # Check not already confirmed at this timestamp
                already = any(
                    o.get("chat_jid") == jid and o.get("confirmation_msg_ts") == yes_dt.isoformat()
                    for o in _detected_orders
                )
                if already:
                    break

                # Also skip if confirmed_at for this JID is newer than this YES
                last_confirmed = confirmed_ts_by_jid.get(jid, "")
                if last_confirmed and yes_dt.isoformat() <= last_confirmed:
                    break

                # Extract product name — first bold word or product keyword in offer
                product_name = ""
                bold_match = re.search(r'\*([^*]+)\*', text)
                if bold_match:
                    product_name = bold_match.group(1).strip()
                # Try matching against catalog
                products = _get_products()
                matched_product = None
                if product_name:
                    matched_product = _get_product_by_name(product_name)
                if not matched_product:
                    # Try to match any product name found in the offer text
                    for p in products:
                        if p.get("name", "").lower() in text.lower():
                            matched_product = p
                            product_name = p["name"]
                            break

                product_id = matched_product.get("id", "") if matched_product else ""
                if not product_name:
                    product_name = "WhatsApp Order"

                customer_name = chat.get("customer_name", jid)
                now_iso = datetime.now(timezone.utc).isoformat()
                order = {
                    "id": f"WA-{uuid.uuid4().hex[:8].upper()}",
                    "channel": "whatsapp",
                    "chat_jid": jid,
                    "customer_name": customer_name,
                    "customer_phone": jid.split("@")[0].split("-")[0],
                    "product_hint": product_name,
                    "product_id": product_id,
                    "qty": 1,
                    "price": price,
                    "total": price,
                    "catalog_price": price,
                    "items": [{"name": product_name, "product_id": product_id, "qty": 1, "price": price}],
                    "confidence": 0.9,
                    "status": "confirmed",
                    "detected_at": now_iso,
                    "confirmed_at": now_iso,
                    "created_at": now_iso,
                    "confirmation_msg_ts": yes_dt.isoformat(),
                    "offer_msg_ts": offer_dt.isoformat(),
                    "source": "whatsapp_self_confirmed",
                    "notes": f"Offer: '{text[:80]}' → YES: '{follow_text}'",
                }
                _detected_orders.append(order)
                _persist_whatsapp_order(order)
                confirmed_ts_by_jid[jid] = yes_dt.isoformat()
                created += 1
                orders_created.append(order)
                logger.info("Self-sent confirmation detected: order %s jid=%s product=%s price=%.0f", order["id"], jid, product_name, price)
                _persist_all()
                _generate_and_send_payment_link(order)
                break  # one YES per offer

    return {"created": created, "orders": orders_created}


# ── Auto-scanner ──────────────────────────────────────────────────────────────

_wa_scheduler = BackgroundScheduler(timezone="Asia/Kolkata")
_last_scan_time: Optional[datetime] = None


def _auto_scan_job() -> None:
    global _last_scan_time
    if not _monitored_chats:
        return
    try:
        result = _run_scan_and_draft()
        _last_scan_time = datetime.now(timezone.utc)
        logger.info("Auto-scan: %d detection(s), %d draft(s)", result["new_detections"], result["new_drafts"])
        _run_check_confirmations()
        self_result = _scan_self_sent_confirmations()
        if self_result["created"] > 0:
            logger.info("Self-sent confirmations: %d new order(s)", self_result["created"])
    except Exception as e:
        logger.error("Auto-scan failed: %s", e)


try:
    _wa_scheduler.add_job(_auto_scan_job, "interval", minutes=2, id="wa_auto_scan", replace_existing=True)
    _wa_scheduler.start()
    logger.info("WhatsApp auto-scanner started (every 2 min)")
except Exception as e:
    logger.warning("Could not start WhatsApp auto-scanner: %s", e)

# Auto-start bridge only if the binary exists (local dev only)
if os.path.exists(BRIDGE_BINARY):
    try:
        _start_bridge()
    except Exception as e:
        logger.warning("Could not auto-start WhatsApp bridge: %s", e)


# ── Pydantic models ───────────────────────────────────────────────────────────

class AddChatPayload(BaseModel):
    chat_name: str
    chat_jid: str
    customer_name: str


class BulkAddChatsEntry(BaseModel):
    chat_jid: str
    chat_name: str
    customer_name: str


class BulkAddChatsPayload(BaseModel):
    chats: List[BulkAddChatsEntry]


class ConfirmOrderPayload(BaseModel):
    order_id: str


class RejectOrderPayload(BaseModel):
    order_id: str


class IncomingMessage(BaseModel):
    chat_jid: str
    message_id: Optional[str] = None
    sender: Optional[str] = None
    text: str
    timestamp: Optional[str] = None


class IncomingMessageBatch(BaseModel):
    chat_jid: str
    messages: List[IncomingMessage]


class ReplyIdPayload(BaseModel):
    reply_id: str


class EditReplyPayload(BaseModel):
    reply_id: str
    message: str


class ConfirmFromWAPayload(BaseModel):
    confirmation_id: str


class SyncProductsPayload(BaseModel):
    products: List[dict]


class DirectMessagePayload(BaseModel):
    jid: str
    message: str
    # Optional — set these when the message is a product offer expecting a YES reply
    product_name: Optional[str] = None
    product_id: Optional[str] = None
    price: Optional[float] = None
    qty: Optional[int] = 1
    customer_name: Optional[str] = None  # resolved name of the recipient
    track_reply: bool = False            # set True to watch for YES reply


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/connect", response_class=None)
async def whatsapp_connect_page():
    """Simple HTML page that shows the QR code — no React needed."""
    from fastapi.responses import HTMLResponse
    d = await bridge_status()
    qr_data = (d.get("qr_b64") or "").replace("qr:", "", 1)
    if d.get("connected"):
        body = "<div class='ok'>✅ WhatsApp Connected!</div>"
    elif qr_data:
        body = f"""
        <p>Open WhatsApp → Linked Devices → Link a Device → scan:</p>
        <div id="qr"></div>
        <p style="color:#888;font-size:13px">This page auto-refreshes every 5s</p>
        <script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
        <script>QRCode.toCanvas(document.createElement('canvas'),{repr(qr_data)},function(e,c){{if(!e){{document.getElementById('qr').appendChild(c);}}}});</script>
        <meta http-equiv="refresh" content="5">"""
    else:
        body = "<div class='warn'>⏳ Bridge starting… <a href=''>Refresh</a></div>"

    html = f"""<!DOCTYPE html><html><head><meta charset='utf-8'>
    <title>Connect WhatsApp</title>
    <style>body{{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f9fa}}
    h2{{color:#1e293b}}canvas{{border:3px solid #25D366;border-radius:12px;padding:8px}}
    .ok{{font-size:24px;color:#166534}}.warn{{font-size:18px;color:#92400e}}</style>
    </head><body><h2>💬 Connect WhatsApp</h2>{body}</body></html>"""
    return HTMLResponse(html)


@router.get("/bridge-status")
async def bridge_status():
    running = _is_bridge_running()
    authenticated = _is_bridge_authenticated()
    connected = running and (authenticated or _wa_connected)
    qr_available = _qr_code_b64 is not None
    return {
        "connected": connected,
        "qr_available": qr_available,
        "qr_b64": _qr_code_b64 if qr_available else None,
        "status": "connected" if connected else ("qr_pending" if qr_available else "offline"),
        "bridge_running": running,
        "authenticated": authenticated,
    }


@router.get("/qr")
async def get_qr():
    if _is_bridge_authenticated() or _wa_connected:
        return {"status": "scanned", "qr_b64": None, "message": "Already authenticated."}
    if _qr_code_b64:
        return {"status": "pending", "qr_b64": _qr_code_b64}
    if not os.path.exists(BRIDGE_BINARY):
        return {"status": "unavailable", "qr_b64": None, "message": "Bridge binary not found."}
    _start_bridge()
    return {"status": "pending", "qr_b64": _qr_code_b64}


@router.post("/start-bridge")
async def start_bridge_endpoint():
    # If an external bridge URL is configured, don't try to spawn a local process
    external = os.environ.get("WHATSAPP_BRIDGE_API", "").strip()
    if external and external != "http://localhost:8080":
        try:
            httpx.post(f"{BRIDGE_API}/api/connect", timeout=5.0)
        except Exception as e:
            logger.debug("Could not trigger external WhatsApp bridge connect: %s", e)
        running = _is_bridge_running()
        return {"started": False, "message": "Using external bridge", "authenticated": _is_bridge_authenticated(), "bridge_running": running}

    if _is_bridge_running():
        return {"started": False, "message": "Bridge already running", "authenticated": _is_bridge_authenticated()}
    if not os.path.exists(BRIDGE_BINARY):
        raise HTTPException(
            status_code=503,
            detail=(
                "WhatsApp bridge cannot run on this server (serverless environment). "
                "Set the WHATSAPP_BRIDGE_API environment variable to your bridge URL."
            ),
        )
    started = _start_bridge()
    return {"started": started, "message": "Bridge started." if started else "Failed to start bridge."}


@router.post("/messages")
async def receive_messages(payload: IncomingMessageBatch):
    """
    Ingest a batch of incoming messages and write them to the local SQLite database.
    Required by wa_scanner.py to push messages from production/remote bridges.
    """
    buffered = 0
    try:
        conn = sqlite3.connect(WHATSAPP_DB_PATH)
        cur = conn.cursor()
        
        # Ensure chat exists in chats table
        cur.execute("SELECT COUNT(*) FROM chats WHERE jid = ?", (payload.chat_jid,))
        if cur.fetchone()[0] == 0:
            cur.execute(
                "INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)",
                (payload.chat_jid, payload.chat_jid.split("@")[0], datetime.now(timezone.utc).isoformat())
            )
            
        for msg in payload.messages:
            msg_id = msg.message_id or str(uuid.uuid4())
            # Use INSERT OR IGNORE to prevent duplicates
            cur.execute(
                """INSERT OR IGNORE INTO messages (id, chat_jid, sender, content, timestamp, is_from_me)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    msg_id,
                    payload.chat_jid,
                    msg.sender or "Customer",
                    msg.text,
                    msg.timestamp or datetime.now(timezone.utc).isoformat(),
                    1 if msg.sender == "me" else 0
                )
            )
            if cur.rowcount > 0:
                buffered += 1
                
        # Update last_message_time in chats
        if payload.messages:
            last_msg = payload.messages[-1]
            cur.execute(
                "UPDATE chats SET last_message_time = ? WHERE jid = ?",
                (last_msg.timestamp or datetime.now(timezone.utc).isoformat(), payload.chat_jid)
            )
            
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error("Failed to buffer messages: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to buffer messages: {e}")
        
    return {"buffered": buffered, "total_buffer": len(payload.messages)}



@router.get("/search-chats")
async def search_chats(q: Optional[str] = None, limit: int = 40):
    chats = _wa_list_chats(query=q, limit=limit)
    return {"chats": chats, "total": len(chats), "source": "real"}


@router.post("/add-chat")
async def add_chat(payload: AddChatPayload):
    jid = payload.chat_jid.strip()
    if any(c["chat_jid"] == jid for c in _monitored_chats):
        raise HTTPException(status_code=409, detail="Chat already monitored")
    entry = {
        "chat_jid": jid,
        "chat_name": payload.chat_name.strip(),
        "customer_name": payload.customer_name.strip(),
        "added_at": datetime.now(timezone.utc).isoformat(),
        "last_scanned": None,
        "order_count": 0,
    }
    _monitored_chats.append(entry)
    _save_json(_CHATS_FILE, _monitored_chats)
    return {"status": "added", "chat": entry}


@router.post("/bulk-add-chats")
async def bulk_add_chats(payload: BulkAddChatsPayload):
    added, skipped, new_chats = 0, 0, []
    for entry in payload.chats:
        jid = entry.chat_jid.strip()
        if any(c["chat_jid"] == jid for c in _monitored_chats):
            skipped += 1
            continue
        chat_entry = {
            "chat_jid": jid,
            "chat_name": entry.chat_name.strip(),
            "customer_name": entry.customer_name.strip(),
            "added_at": datetime.now(timezone.utc).isoformat(),
            "last_scanned": None,
            "order_count": 0,
        }
        _monitored_chats.append(chat_entry)
        new_chats.append(chat_entry)
        added += 1
    _save_json(_CHATS_FILE, _monitored_chats)
    return {"added": added, "skipped": skipped, "chats": new_chats}


@router.get("/chats")
async def list_chats():
    return {"chats": _monitored_chats, "total": len(_monitored_chats)}


@router.delete("/chats/{jid:path}")
async def remove_chat(jid: str):
    global _monitored_chats
    before = len(_monitored_chats)
    _monitored_chats = [c for c in _monitored_chats if c["chat_jid"] != jid]
    if len(_monitored_chats) == before:
        raise HTTPException(status_code=404, detail="Chat not found")
    _save_json(_CHATS_FILE, _monitored_chats)
    return {"status": "removed", "chat_jid": jid}


@router.post("/scan")
async def scan_chats(chat_jid: Optional[str] = None):
    return _run_scan_and_draft(chat_jid=chat_jid)


@router.get("/detected-orders")
async def get_detected_orders(status: Optional[str] = None, chat_jid: Optional[str] = None):
    orders = _detected_orders[:]
    if status:
        orders = [o for o in orders if o["status"] == status]
    if chat_jid:
        orders = [o for o in orders if o["chat_jid"] == chat_jid]
    return {
        "orders": sorted(orders, key=lambda o: o.get("detected_at") or o.get("created_at") or "", reverse=True),
        "total": len(orders),
        "pending": sum(1 for o in _detected_orders if o["status"] == "pending"),
        "confirmed": sum(1 for o in _detected_orders if o["status"] == "confirmed"),
        "rejected": sum(1 for o in _detected_orders if o["status"] == "rejected"),
    }


@router.post("/confirm-order")
async def confirm_order(payload: ConfirmOrderPayload):
    order = next((o for o in _detected_orders if o["id"] == payload.order_id), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Order already {order['status']}")
    order["status"] = "confirmed"
    order["confirmed_at"] = datetime.now(timezone.utc).isoformat()
    if not order.get("items"):
        order["items"] = [{
            "name": order.get("product_hint") or "WhatsApp Order",
            "product_id": order.get("product_id"),
            "sku": order.get("product_sku"),
            "qty": order.get("qty", 1),
            "price": order.get("catalog_price") or order.get("price") or 0,
        }]
    order["total"] = _order_total(order)
    _persist_whatsapp_order(order)
    _persist_all()
    ls_order = _local_storage_payload(order)
    return {"status": "confirmed", "order": order, "localStorage_payload": ls_order}


@router.post("/reject-order")
async def reject_order(payload: RejectOrderPayload):
    order = next((o for o in _detected_orders if o["id"] == payload.order_id), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Order already {order['status']}")
    order["status"] = "rejected"
    order["rejected_at"] = datetime.now(timezone.utc).isoformat()
    _persist_all()
    return {"status": "rejected", "order": order}


@router.get("/products")
async def get_products_endpoint():
    products = _get_products()
    return {"products": products, "total": len(products)}


@router.post("/send-direct")
async def send_direct(payload: DirectMessagePayload):
    """
    Send a message directly to any JID — used by CRM broadcast.
    If product_name + track_reply=True are set, the JID is registered as
    waiting_confirm so any YES reply will auto-create an order.
    """
    if not _is_bridge_running():
        raise HTTPException(status_code=503, detail="WhatsApp bridge is not running.")
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(
                f"{BRIDGE_API}/api/send",
                json={"recipient": payload.jid, "message": payload.message},
            )
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Bridge error {resp.status_code}: {resp.text}")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot connect to WhatsApp bridge.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Send failed: {e}")

    sent_at = datetime.now(timezone.utc).isoformat()
    _buffer_whatsapp_message(
        chat_jid=payload.jid,
        message_id=f"out-{uuid.uuid4()}",
        sender="me",
        text=payload.message,
        timestamp=sent_at,
        is_from_me=True,
        chat_name=payload.customer_name or payload.jid,
    )

    # ── Register waiting_confirm state so YES reply triggers order creation ──
    if payload.track_reply and payload.product_name:
        jid = payload.jid

        # Ensure this contact is in monitored chats (needed by _create_confirmed_order)
        if not any(c["chat_jid"] == jid for c in _monitored_chats):
            _monitored_chats.append({
                "chat_jid": jid,
                "chat_name": payload.customer_name or jid,
                "customer_name": payload.customer_name or jid,
                "added_at": datetime.now(timezone.utc).isoformat(),
                "source": "crm_broadcast",
            })
            _save_json(_CHATS_FILE, _monitored_chats)

        # Append a new broadcast entry — never overwrite, supports multiple orders per contact
        broadcast_entry = {
            "id": str(uuid.uuid4()),
            "jid": jid,
            "customer_name": payload.customer_name or jid,
            "product_name": payload.product_name,
            "product_id": payload.product_id or "",
            "price": payload.price or 0.0,
            "qty": payload.qty or 1,
            "sent_at": sent_at,
            "source": "crm_broadcast",
            "confirmed": False,
            "last_confirmed_message_ts": None,  # tracks last YES timestamp seen
        }
        _pending_broadcasts.append(broadcast_entry)
        # Keep legacy state in sync (for backward compat with other code that reads it)
        _conversation_states[jid] = {
            "state": "waiting_confirm",
            "product_name": payload.product_name,
            "product_id": payload.product_id or "",
            "price": payload.price or 0.0,
            "qty": payload.qty or 1,
            "sent_at": broadcast_entry["sent_at"],
            "source": "crm_broadcast",
        }
        _persist_all()
        logger.info("CRM broadcast: tracking YES reply for jid=%s product=%s broadcast_id=%s", jid, payload.product_name, broadcast_entry["id"])

    return {"sent": True, "jid": payload.jid, "tracking": payload.track_reply and bool(payload.product_name)}


@router.post("/sync-products")
async def sync_products(payload: SyncProductsPayload):
    global _synced_products
    _synced_products = payload.products
    logger.info("Product catalog synced: %d product(s)", len(_synced_products))
    return {"synced": len(_synced_products), "products": _synced_products}


def _replies_response(replies: List[dict]) -> dict:
    return {
        "replies": sorted(replies, key=lambda r: r["created_at"], reverse=True),
        "total": len(replies),
        "draft_count": sum(1 for r in _drafted_replies if r["status"] == "draft"),
        "sent_count": sum(1 for r in _drafted_replies if r["status"] == "sent"),
    }


@router.get("/draft-replies")
async def get_draft_replies(status: Optional[str] = None):
    replies = _drafted_replies[:]
    if status:
        replies = [r for r in replies if r["status"] == status]
    return _replies_response(replies)


@router.post("/send-reply")
async def send_reply(payload: ReplyIdPayload):
    reply = next((r for r in _drafted_replies if r["id"] == payload.reply_id), None)
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")
    if reply["status"] != "draft":
        raise HTTPException(status_code=409, detail=f"Reply already {reply['status']}")
    if not _is_bridge_running():
        raise HTTPException(status_code=503, detail="WhatsApp bridge is not running.")
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post(
                f"{BRIDGE_API}/api/send",
                json={"recipient": reply["chat_jid"], "message": reply["draft_message"]},
            )
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Bridge error {resp.status_code}: {resp.text}")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot connect to WhatsApp bridge.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Send failed: {e}")

    sent_at = datetime.now(timezone.utc).isoformat()
    reply["status"] = "sent"
    reply["sent_at"] = sent_at

    jid = reply["chat_jid"]
    _buffer_whatsapp_message(
        chat_jid=jid,
        message_id=f"out-{uuid.uuid4()}",
        sender="me",
        text=reply["draft_message"],
        timestamp=sent_at,
        is_from_me=True,
        chat_name=reply.get("customer_name") or jid,
    )
    if jid in _conversation_states:
        _conversation_states[jid]["sent_at"] = sent_at

    _pending_confirmations.append({
        "id": str(uuid.uuid4()),
        "reply_id": reply["id"],
        "chat_jid": jid,
        "customer_name": reply.get("customer_name", "Customer"),
        "product_hint": reply.get("product_name", ""),
        "product_id": reply.get("product_id"),
        "qty": reply.get("qty", 1),
        "price": reply.get("catalog_price"),
        "created_at": sent_at,
        "confirmed": False,
        "auto_detected": False,
    })
    _persist_all()
    return {"sent": True, "message": "Reply sent successfully", "reply": reply}


@router.post("/skip-reply")
async def skip_reply(payload: ReplyIdPayload):
    reply = next((r for r in _drafted_replies if r["id"] == payload.reply_id), None)
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")
    reply["status"] = "skipped"
    reply["skipped_at"] = datetime.now(timezone.utc).isoformat()
    _persist_all()
    return {"skipped": True, "reply": reply}


@router.post("/edit-reply")
async def edit_reply(payload: EditReplyPayload):
    reply = next((r for r in _drafted_replies if r["id"] == payload.reply_id), None)
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")
    if reply["status"] != "draft":
        raise HTTPException(status_code=409, detail=f"Cannot edit a {reply['status']} reply")
    reply["draft_message"] = payload.message
    reply["message_text"] = payload.message
    reply["edited_at"] = datetime.now(timezone.utc).isoformat()
    _persist_all()
    return {"status": "edited", "reply": reply}


@router.post("/check-confirmations")
async def check_confirmations():
    result = _run_check_confirmations()
    self_result = _scan_self_sent_confirmations()
    return {**result, "self_sent_created": self_result["created"], "self_sent_orders": self_result["orders"]}


@router.get("/next-scan-in")
async def next_scan_in():
    try:
        job = _wa_scheduler.get_job("wa_auto_scan")
        if job and job.next_run_time:
            now = datetime.now(job.next_run_time.tzinfo)
            seconds = max(0, int((job.next_run_time - now).total_seconds()))
            return {"seconds": seconds, "next_at": job.next_run_time.isoformat()}
    except Exception:
        pass
    return {"seconds": 120, "next_at": None}


@router.get("/pending-confirmations")
async def get_pending_confirmations():
    return {
        "confirmations": sorted(_pending_confirmations, key=lambda c: c["created_at"], reverse=True),
        "total": len(_pending_confirmations),
        "waiting": sum(1 for c in _pending_confirmations if not c["confirmed"]),
        "confirmed": sum(1 for c in _pending_confirmations if c["confirmed"]),
    }


@router.get("/crm-funnel")
async def get_crm_funnel():
    """
    Returns CRM broadcast funnel data:
    - Per-contact: messages sent, whether waiting_confirm, whether confirmed
    - Group tracking: all group JIDs that have been messaged via CRM
    - Overall funnel counts
    """
    now = datetime.now(timezone.utc)

    # Build per-contact broadcast history from conversation states + detected orders
    broadcasts = []
    for jid, state in _conversation_states.items():
        if state.get("source") != "crm_broadcast":
            continue
        chat = next((c for c in _monitored_chats if c["chat_jid"] == jid), {})
        confirmed_order = next((o for o in _detected_orders if o.get("chat_jid") == jid and o["status"] == "confirmed"), None)
        sent_at = state.get("sent_at", "")
        broadcasts.append({
            "jid": jid,
            "name": chat.get("customer_name") or chat.get("chat_name") or jid,
            "is_group": jid.endswith("@g.us"),
            "product_name": state.get("product_name", ""),
            "price": state.get("price", 0),
            "sent_at": sent_at,
            "current_state": state.get("state", "idle"),
            "confirmed": confirmed_order is not None,
            "confirmed_at": confirmed_order.get("confirmed_at", "") if confirmed_order else "",
            "order_id": confirmed_order.get("id", "") if confirmed_order else "",
        })

    # Also include confirmed orders that came through crm_broadcast but state already moved to idle
    for order in _detected_orders:
        if order.get("source") != "crm_broadcast":
            continue
        jid = order.get("chat_jid", "")
        if any(b["jid"] == jid for b in broadcasts):
            continue
        chat = next((c for c in _monitored_chats if c["chat_jid"] == jid), {})
        broadcasts.append({
            "jid": jid,
            "name": chat.get("customer_name") or order.get("customer_name") or jid,
            "is_group": jid.endswith("@g.us"),
            "product_name": order.get("product_hint", ""),
            "price": order.get("price", 0),
            "sent_at": order.get("confirmed_at", ""),
            "current_state": "idle",
            "confirmed": order["status"] == "confirmed",
            "confirmed_at": order.get("confirmed_at", ""),
            "order_id": order.get("id", ""),
        })

    total_sent = len(broadcasts)
    total_confirmed = sum(1 for b in broadcasts if b["confirmed"])
    total_waiting = sum(1 for b in broadcasts if b["current_state"] == "waiting_confirm")
    groups = [b for b in broadcasts if b["is_group"]]
    individuals = [b for b in broadcasts if not b["is_group"]]

    return {
        "funnel": {
            "sent": total_sent,
            "waiting": total_waiting,
            "confirmed": total_confirmed,
            "conversion_rate": round(total_confirmed / total_sent * 100, 1) if total_sent else 0,
        },
        "broadcasts": sorted(broadcasts, key=lambda b: b.get("sent_at", ""), reverse=True),
        "groups": sorted(groups, key=lambda b: b.get("sent_at", ""), reverse=True),
        "individuals": sorted(individuals, key=lambda b: b.get("sent_at", ""), reverse=True),
    }


class ManualConfirmPayload(BaseModel):
    jid: str
    qty: Optional[int] = 1


@router.post("/crm-manual-confirm")
async def crm_manual_confirm(payload: ManualConfirmPayload):
    """Manually mark a CRM broadcast JID as confirmed — used when customer confirmed outside WhatsApp."""
    jid = payload.jid
    state = _conversation_states.get(jid)
    if not state:
        raise HTTPException(status_code=404, detail="No broadcast state found for this JID")
    if state.get("state") == "idle" and any(o.get("chat_jid") == jid and o.get("status") == "confirmed" for o in _detected_orders):
        return {"already_confirmed": True}

    # Force state to waiting_confirm if somehow it's idle but no confirmed order exists
    if state.get("state") != "waiting_confirm":
        state["state"] = "waiting_confirm"

    result = _create_confirmed_order(jid)
    if not result:
        raise HTTPException(status_code=500, detail="Could not create confirmed order")
    _persist_all()
    logger.info("Manual confirm for jid=%s order=%s", jid, result.get("id"))
    return {"confirmed": True, "order": result}


@router.post("/confirm-from-wa")
async def confirm_from_wa(payload: ConfirmFromWAPayload):
    conf = next((c for c in _pending_confirmations if c["id"] == payload.confirmation_id), None)
    if not conf:
        raise HTTPException(status_code=404, detail="Confirmation not found")
    conf["confirmed"] = True
    conf["manually_confirmed_at"] = datetime.now(timezone.utc).isoformat()
    if conf.get("product_id"):
        _deduct_stock(conf["product_id"], conf.get("qty", 1))
    now_iso = datetime.now(timezone.utc).isoformat()
    channel_order_id = f"WA-{uuid.uuid4().hex[:8].upper()}"
    order = {
        "id": channel_order_id,
        "channel": "whatsapp",
        "channel_order_id": channel_order_id,
        "chat_jid": conf["chat_jid"],
        "customer_name": conf.get("customer_name", "Customer"),
        "customer_phone": _phone_from_jid(conf.get("chat_jid", "")),
        "message_text": "Manual WhatsApp confirmation",
        "product_hint": conf.get("product_hint", "WhatsApp Order"),
        "product_id": conf.get("product_id"),
        "qty": conf.get("qty", 1),
        "price": conf.get("price") or 0,
        "catalog_price": conf.get("price") or 0,
        "total": (conf.get("price") or 0) * conf.get("qty", 1),
        "items": [{
            "name": conf.get("product_hint", "WhatsApp Order"),
            "product_id": conf.get("product_id"),
            "qty": conf.get("qty", 1),
            "price": conf.get("price") or 0,
        }],
        "confidence": 1.0,
        "status": "confirmed",
        "detected_at": now_iso,
        "confirmed_at": now_iso,
        "source": "whatsapp_manual_confirmation",
    }
    _detected_orders.append(order)
    _persist_whatsapp_order(order)
    _persist_all()
    ls_order = _local_storage_payload(order)
    return {"status": "confirmed", "confirmation": conf, "localStorage_payload": ls_order}


# ------------------------------------------------------------------ #
# Available chats (all contacts + groups from bridge DB)
# ------------------------------------------------------------------ #

@router.get("/available-chats")
async def available_chats(query: Optional[str] = None, limit: int = 100):
    """
    All WhatsApp contacts and groups visible to the bridge — not just monitored ones.
    Used by the share panel to let the user pick recipients.
    """
    return {"chats": _wa_list_chats(query=query, limit=limit)}


# ------------------------------------------------------------------ #
# Bulk broadcast — send same message to multiple JIDs
# ------------------------------------------------------------------ #

class BroadcastBulkPayload(BaseModel):
    jids: List[str]
    message: str
    product_name: Optional[str] = None
    product_id: Optional[str] = None
    price: Optional[float] = None
    qty: Optional[int] = 1
    track_reply: bool = True


@router.post("/broadcast-bulk")
async def broadcast_bulk(payload: BroadcastBulkPayload):
    """
    Send the same message to multiple JIDs at 1 msg/sec.
    Substitutes {name} from the contacts table when a match is found.
    Appends each to _pending_broadcasts when track_reply=True.
    """
    import time as _time

    if not _is_bridge_running():
        raise HTTPException(status_code=503, detail="WhatsApp bridge is not running.")

    db = get_db()
    # Build JID → name map from contacts table
    try:
        all_contacts = db.table("contacts").select("whatsapp_jid, name").not_.is_("whatsapp_jid", "null").execute().data
        jid_to_name = {c["whatsapp_jid"]: c["name"] for c in all_contacts if c.get("whatsapp_jid")}
    except Exception:
        jid_to_name = {}

    sent, failed = [], []
    for jid in payload.jids:
        contact_name = jid_to_name.get(jid) or jid.replace("@s.whatsapp.net", "").replace("@g.us", "Group")
        message = payload.message.replace("{name}", contact_name)

        try:
            with httpx.Client(timeout=8.0) as client:
                resp = client.post(f"{BRIDGE_API}/api/send", json={"recipient": jid, "message": message})
                if resp.status_code >= 400:
                    failed.append({"jid": jid, "error": f"Bridge HTTP {resp.status_code}"})
                    continue
        except Exception as e:
            failed.append({"jid": jid, "error": str(e)})
            continue

        sent_at = datetime.now(timezone.utc).isoformat()
        _buffer_whatsapp_message(
            chat_jid=jid,
            message_id=f"out-{uuid.uuid4()}",
            sender="me",
            text=message,
            timestamp=sent_at,
            is_from_me=True,
            chat_name=contact_name,
        )

        if payload.track_reply and payload.product_name:
            if not any(c["chat_jid"] == jid for c in _monitored_chats):
                _monitored_chats.append({
                    "chat_jid": jid,
                    "chat_name": contact_name,
                    "customer_name": contact_name,
                    "added_at": datetime.now(timezone.utc).isoformat(),
                    "source": "broadcast_bulk",
                })
            broadcast_entry = {
                "id": str(uuid.uuid4()),
                "jid": jid,
                "customer_name": contact_name,
                "product_name": payload.product_name,
                "product_id": payload.product_id or "",
                "price": payload.price or 0.0,
                "qty": payload.qty or 1,
                "sent_at": sent_at,
                "source": "broadcast_bulk",
                "confirmed": False,
                "last_confirmed_message_ts": None,
            }
            _pending_broadcasts.append(broadcast_entry)
            _conversation_states[jid] = {
                "state": "waiting_confirm",
                "product_name": payload.product_name,
                "product_id": payload.product_id or "",
                "price": payload.price or 0.0,
                "qty": payload.qty or 1,
                "sent_at": broadcast_entry["sent_at"],
                "source": "broadcast_bulk",
            }

        sent.append(jid)
        _time.sleep(1)  # 1 msg/sec — stay well under WhatsApp rate limits

    _persist_all()
    return {"sent": len(sent), "failed": failed, "tracking": payload.track_reply}


# ------------------------------------------------------------------ #
# Share catalog item — high-level wrapper over broadcast-bulk
# ------------------------------------------------------------------ #

class SharePayload(BaseModel):
    product_id: str
    contact_ids: List[str] = []      # contacts table IDs
    list_ids: List[str] = []         # contact_lists table IDs
    group_jids: List[str] = []       # raw group JIDs
    template: str = "offer"
    custom_message: Optional[str] = None
    track_reply: bool = True


@router.post("/share")
async def share_catalog_item(payload: SharePayload):
    """
    Share a product to any combination of contacts, broadcast lists, and groups.
    Resolves JIDs, generates per-recipient messages, delegates to broadcast-bulk logic.
    """
    from ..catalog.link_generator import generate_product_message, product_to_dict

    if not _is_bridge_running():
        raise HTTPException(status_code=503, detail="WhatsApp bridge is not running.")

    db = get_db()

    # 1. Load product
    product_row = db.table("products").select("*, skus(selling_price, mrp)").eq("id", payload.product_id).execute()
    if not product_row.data:
        raise HTTPException(status_code=404, detail="Product not found")
    product = product_to_dict(product_row.data[0])

    # 2. Resolve JIDs from contact_ids
    jid_name_map: dict[str, str] = {}
    if payload.contact_ids:
        rows = db.table("contacts").select("whatsapp_jid, name").in_("id", payload.contact_ids).not_.is_("whatsapp_jid", "null").execute().data
        for r in rows:
            if r.get("whatsapp_jid"):
                jid_name_map[r["whatsapp_jid"]] = r["name"]

    # 3. Resolve JIDs from list_ids
    if payload.list_ids:
        for list_id in payload.list_ids:
            members = db.table("contact_list_members").select("contacts(whatsapp_jid, name)").eq("list_id", list_id).execute().data
            for m in members:
                c = m.get("contacts") or {}
                if c.get("whatsapp_jid"):
                    jid_name_map[c["whatsapp_jid"]] = c.get("name", "")

    # 4. Add raw group JIDs
    for jid in payload.group_jids:
        if jid not in jid_name_map:
            jid_name_map[jid] = jid.replace("@g.us", "Group")

    if not jid_name_map:
        raise HTTPException(status_code=400, detail="No valid WhatsApp recipients resolved. Verify contacts are checked for WhatsApp.")

    import time as _time
    sent, failed = [], []
    for jid, contact_name in jid_name_map.items():
        if payload.custom_message:
            message = payload.custom_message.replace("{name}", contact_name)
        else:
            message = generate_product_message(product, payload.template, contact_name)

        try:
            with httpx.Client(timeout=8.0) as client:
                resp = client.post(f"{BRIDGE_API}/api/send", json={"recipient": jid, "message": message})
                if resp.status_code >= 400:
                    failed.append({"jid": jid, "error": f"Bridge HTTP {resp.status_code}"})
                    continue
        except Exception as e:
            failed.append({"jid": jid, "error": str(e)})
            continue

        sent_at = datetime.now(timezone.utc).isoformat()
        _buffer_whatsapp_message(
            chat_jid=jid,
            message_id=f"out-{uuid.uuid4()}",
            sender="me",
            text=message,
            timestamp=sent_at,
            is_from_me=True,
            chat_name=contact_name,
        )

        if payload.track_reply:
            if not any(c["chat_jid"] == jid for c in _monitored_chats):
                _monitored_chats.append({
                    "chat_jid": jid, "chat_name": contact_name,
                    "customer_name": contact_name,
                    "added_at": datetime.now(timezone.utc).isoformat(),
                    "source": "share",
                })
            entry = {
                "id": str(uuid.uuid4()),
                "jid": jid, "customer_name": contact_name,
                "product_name": product["name"],
                "product_id": payload.product_id,
                "price": product.get("selling_price") or 0.0,
                "qty": 1,
                "sent_at": sent_at,
                "source": "share",
                "confirmed": False,
                "last_confirmed_message_ts": None,
            }
            _pending_broadcasts.append(entry)
            _conversation_states[jid] = {
                "state": "waiting_confirm",
                "product_name": product["name"],
                "product_id": payload.product_id,
                "price": entry["price"], "qty": 1,
                "sent_at": entry["sent_at"], "source": "share",
            }

        sent.append({"jid": jid, "name": contact_name})
        _time.sleep(1)

    _persist_all()
    return {
        "product": product["name"],
        "sent": len(sent),
        "recipients": sent,
        "failed": failed,
        "tracking": payload.track_reply,
    }


# ------------------------------------------------------------------ #
# Baileys bridge incoming message webhook
# Called by the Node.js bridge when a customer sends a message
# ------------------------------------------------------------------ #

class IncomingMessagePayload(BaseModel):
    from_: str = Field(default="", alias="from")
    body: str = ""
    timestamp: Optional[Any] = None
    message_id: Optional[str] = None
    order_data: Optional[dict] = None

    model_config = {"populate_by_name": True}


@router.post("/incoming")
async def incoming_message(payload: IncomingMessagePayload):
    """
    Receives messages forwarded by the Baileys Node.js bridge.
    Processes them through the same order-intent detection pipeline.
    """
    global _wa_connected, _qr_code_b64
    _wa_connected = True  # If messages are coming in, we're connected
    _qr_code_b64 = None

    from_jid = payload.from_ if "@" in payload.from_ else f"{payload.from_}@s.whatsapp.net"
    body = payload.body or ""
    timestamp_iso = _normalise_message_timestamp(payload.timestamp)

    if body:
        _buffer_whatsapp_message(
            chat_jid=from_jid,
            message_id=payload.message_id,
            sender=from_jid,
            text=body,
            timestamp=timestamp_iso,
            is_from_me=False,
            chat_name=from_jid.split("@")[0],
        )
        if not any(c["chat_jid"] == from_jid for c in _monitored_chats):
            _monitored_chats.append({
                "chat_jid": from_jid,
                "chat_name": from_jid.split("@")[0],
                "customer_name": from_jid.split("@")[0],
                "added_at": datetime.now(timezone.utc).isoformat(),
                "last_scanned": None,
                "order_count": 0,
                "source": "baileys_incoming",
            })
            _save_json(_CHATS_FILE, _monitored_chats)

    # Handle WhatsApp order (product card tap)
    if payload.order_data:
        items = payload.order_data.get("product_items") or payload.order_data.get("products", [])
        if items:
            normalised_items = []
            for item in items:
                sku = item.get("product_retailer_id") or item.get("sku")
                normalised_items.append({
                    "name": item.get("name") or sku or "WhatsApp Product",
                    "sku": sku,
                    "channel_sku_id": sku,
                    "qty": _safe_int(item.get("quantity"), 1),
                    "price": _safe_float(item.get("item_price"), _safe_float(item.get("price"))),
                })
            total = _total_for_items(normalised_items)
            now_iso = datetime.now(timezone.utc).isoformat()
            channel_order_id = f"WA-{uuid.uuid4().hex[:8].upper()}"
            order = {
                "id": channel_order_id,
                "channel": "whatsapp",
                "channel_order_id": channel_order_id,
                "chat_jid": from_jid,
                "customer_name": from_jid.split("@")[0],
                "customer_phone": _phone_from_jid(from_jid),
                "message_text": body or "WhatsApp product-card order",
                "product_hint": normalised_items[0]["name"] if normalised_items else "WhatsApp Order",
                "items": normalised_items,
                "qty": sum(i["qty"] for i in normalised_items),
                "price": total,
                "total": total,
                "catalog_price": normalised_items[0]["price"] if normalised_items else 0,
                "confidence": 1.0,
                "status": "confirmed",
                "detected_at": now_iso,
                "confirmed_at": now_iso,
                "message_id": payload.message_id or str(uuid.uuid4()),
                "source": "whatsapp_product_card",
                "raw_order_data": payload.order_data,
            }
            _detected_orders.append(order)
            _persist_whatsapp_order(order)
            _persist_all()
            _generate_and_send_payment_link(order)
            return {"status": "order_confirmed", "total": total, "order": order}

    # Text message — run through order intent detection
    if body:
        body_lower = body.lower().strip()
        YES_WORDS = {"yes", "haan", "ha", "ok", "okay", "confirm", "order", "buy", "yes!", "yep"}

        if body_lower in YES_WORDS:
            # Find a pending broadcast for this JID and confirm it
            for bc in reversed(_pending_broadcasts):
                if bc["jid"] == from_jid and not bc.get("confirmed"):
                    result = _create_confirmed_order_from_broadcast(from_jid, bc)
                    if result:
                        bc["confirmed"] = True
                        bc["confirmed_at"] = datetime.now(timezone.utc).isoformat()
                        _persist_all()
                    return {"status": "order_confirmed"}

            _check_for_customer_confirmation(from_jid, body, {
                "id": payload.message_id or str(uuid.uuid4()),
                "timestamp": timestamp_iso,
                "text": body,
                "sender": from_jid,
            })
            _persist_all()
            return {"status": "confirmation_checked"}

        scan_result = _run_scan_and_draft(from_jid)
        return {"status": "buffered", **scan_result}

    return {"status": "ok"}


@router.post("/bridge-connected")
async def bridge_connected(payload: dict):
    """Called by Baileys bridge when WhatsApp connects successfully."""
    global _wa_connected, _qr_code_b64
    _wa_connected = True
    _qr_code_b64 = None
    logger.info("WhatsApp bridge connected: phone=%s", payload.get("phone"))
    return {"status": "noted"}
