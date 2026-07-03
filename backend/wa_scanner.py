#!/usr/bin/env python3
"""
WhatsApp Order Scanner

Reads messages for a monitored chat and pushes them to the d2cflow backend
for order intent detection.

Usage:
  python -m backend.wa_scanner --chat-jid 919876543210@s.whatsapp.net --chat-name "Priya Sharma"
  python -m backend.wa_scanner --all        # scan all monitored chats
  WHATSAPP_BACKEND_URL=http://localhost:8000 python -m backend.wa_scanner --all

Environment variables:
  WHATSAPP_BACKEND_URL  Backend base URL (default: http://localhost:8000)
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

BACKEND_URL = os.environ.get("WHATSAPP_BACKEND_URL", "http://localhost:8000")


def _post(path: str, data: dict) -> dict:
    url = f"{BACKEND_URL}{path}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[wa_scanner] HTTP {e.code} from {path}: {body}", file=sys.stderr)
        return {"error": body}
    except Exception as e:
        print(f"[wa_scanner] Request failed for {path}: {e}", file=sys.stderr)
        return {"error": str(e)}


def _get(path: str) -> dict:
    url = f"{BACKEND_URL}{path}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"[wa_scanner] GET {path} failed: {e}", file=sys.stderr)
        return {"error": str(e)}


def scan_chat(chat_jid: str, chat_name: str = "") -> dict:
    """Fetch messages for a chat and push them to the backend."""
    # Import here to support running as __main__ too
    sys.path.insert(0, str(Path(__file__).parent.parent))
    try:
        from backend.wa_mcp_bridge import fetch_messages
    except ImportError:
        try:
            from wa_mcp_bridge import fetch_messages
        except ImportError:
            print("[wa_scanner] Could not import wa_mcp_bridge; using empty messages", file=sys.stderr)
            def fetch_messages(jid, limit=50): return []

    messages = fetch_messages(chat_jid, limit=50)
    print(f"[wa_scanner] Fetched {len(messages)} messages for {chat_jid}")

    if not messages:
        return {"buffered": 0, "total_buffer": 0}

    # Convert messages to IncomingMessage format
    normalized = []
    for m in messages:
        normalized.append({
            "chat_jid": chat_jid,
            "message_id": m.get("id") or m.get("message_id"),
            "sender": m.get("sender"),
            "text": m.get("text", ""),
            "timestamp": m.get("timestamp"),
        })

    batch = {"chat_jid": chat_jid, "messages": normalized}
    result = _post("/api/whatsapp/messages", batch)
    print(f"[wa_scanner] Buffered {result.get('buffered', 0)} new messages")
    return result


def scan_all() -> list[dict]:
    """Fetch all monitored chats and scan each one."""
    data = _get("/api/whatsapp/chats")
    chats = data.get("chats", [])
    if not chats:
        print("[wa_scanner] No monitored chats found. Add chats via /api/whatsapp/add-chat first.")
        return []

    results = []
    for chat in chats:
        jid = chat["chat_jid"]
        name = chat.get("chat_name", "")
        print(f"[wa_scanner] Scanning: {name} ({jid})")
        r = scan_chat(jid, name)
        results.append({"chat_jid": jid, **r})

    # Trigger scan on backend to process buffered messages
    scan_result = _post("/api/whatsapp/scan", {})
    print(f"[wa_scanner] Scan complete: {scan_result.get('new_detections', 0)} new detections, "
          f"{scan_result.get('total_pending', 0)} pending orders")
    return results


def main():
    global BACKEND_URL

    parser = argparse.ArgumentParser(description="WhatsApp Order Scanner")
    parser.add_argument("--chat-jid", help="Specific chat JID to scan")
    parser.add_argument("--chat-name", default="", help="Chat display name")
    parser.add_argument("--all", action="store_true", help="Scan all monitored chats")
    parser.add_argument("--backend-url", default=BACKEND_URL, help=f"Backend URL (default: {BACKEND_URL})")
    args = parser.parse_args()

    BACKEND_URL = args.backend_url

    if args.all:
        scan_all()
    elif args.chat_jid:
        result = scan_chat(args.chat_jid, args.chat_name)
        # Also trigger backend scan
        scan_result = _post(f"/api/whatsapp/scan?chat_jid={args.chat_jid}", {})
        print(f"[wa_scanner] Scan complete: {scan_result.get('new_detections', 0)} new detections")
    else:
        parser.print_help()
        print("\nExample:")
        print("  python -m backend.wa_scanner --all")
        print("  python -m backend.wa_scanner --chat-jid 919876543210@s.whatsapp.net --chat-name 'Priya'")
        sys.exit(1)


if __name__ == "__main__":
    main()
