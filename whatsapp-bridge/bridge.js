/**
 * WhatsApp Bridge — Baileys-based
 * Exposes the same HTTP API the Python backend expects:
 *   POST /api/send        { recipient, message }
 *   GET  /                health check
 *   GET  /api/status      connection + QR state
 *
 * Incoming messages are forwarded to the Python backend via webhook.
 */

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8080;
const PYTHON_BACKEND = process.env.PYTHON_BACKEND || 'http://localhost:8000';
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth');
const STORE_DIR = process.env.STORE_DIR || path.join(__dirname, 'store');
const CHATS_FILE = path.join(STORE_DIR, 'chats.json');
const LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

// Ensure auth directory exists
fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(STORE_DIR, { recursive: true });

const app = express();
app.use(express.json());

// ── State ──────────────────────────────────────────────────────────────────
let sock = null;
let currentQR = null;
let connected = false;
let connecting = false;
let phoneNumber = '';
let knownChats = loadKnownChats();

function loadKnownChats() {
  try {
    if (fs.existsSync(CHATS_FILE)) {
      return new Map(JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8')).map((c) => [c.jid, c]));
    }
  } catch (e) {
    console.error('[Bridge] Failed to load chats:', e.message);
  }
  return new Map();
}

function saveKnownChats() {
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify([...knownChats.values()], null, 2));
  } catch (e) {
    console.error('[Bridge] Failed to save chats:', e.message);
  }
}

function isUsefulJid(jid = '') {
  return (
    (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us')) &&
    !jid.includes('@lid') &&
    !jid.includes('@broadcast') &&
    !jid.includes('@newsletter')
  );
}

function rememberChat(jid, attrs = {}) {
  if (!isUsefulJid(jid)) return;
  const prev = knownChats.get(jid) || {};
  knownChats.set(jid, {
    jid,
    name: attrs.name || prev.name || attrs.notify || attrs.subject || jid.split('@')[0],
    is_group: jid.endsWith('@g.us'),
    last_message_time: attrs.last_message_time || prev.last_message_time || null,
  });
}

function normaliseTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  if (typeof ts === 'number') {
    return new Date(ts > 10_000_000_000 ? ts : ts * 1000).toISOString();
  }
  if (typeof ts === 'object' && typeof ts.toNumber === 'function') {
    const n = ts.toNumber();
    return new Date(n > 10_000_000_000 ? n : n * 1000).toISOString();
  }
  return String(ts);
}

function unwrapMessage(message = {}) {
  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.documentWithCaptionMessage?.message ||
    message
  );
}

function extractBody(message = {}) {
  const unwrapped = unwrapMessage(message);
  return (
    unwrapped.conversation ||
    unwrapped.extendedTextMessage?.text ||
    unwrapped.imageMessage?.caption ||
    unwrapped.videoMessage?.caption ||
    unwrapped.buttonsResponseMessage?.selectedDisplayText ||
    unwrapped.buttonsResponseMessage?.selectedButtonId ||
    unwrapped.listResponseMessage?.title ||
    unwrapped.listResponseMessage?.singleSelectReply?.selectedRowId ||
    unwrapped.templateButtonReplyMessage?.selectedDisplayText ||
    unwrapped.templateButtonReplyMessage?.selectedId ||
    ''
  );
}

// ── Start WhatsApp connection ─────────────────────────────────────────────

async function connect() {
  if (connecting) return;
  connecting = true;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`[Bridge] Using WA v${version.join('.')}`);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: require('pino')({ level: LOG_LEVEL }),
    browser: ['d2cflow', 'Chrome', '120.0.0'],
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 15000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      connected = false;
      qrcode.generate(qr, { small: true });
      console.log('[Bridge] QR code ready — scan in WhatsApp → Linked Devices');
    }

    if (connection === 'open') {
      currentQR = null;
      connected = true;
      connecting = false;
      phoneNumber = sock.user?.id?.split(':')[0] || '';
      console.log(`[Bridge] Connected as +${phoneNumber}`);

      // Notify Python backend
      notifyPython('/api/whatsapp/bridge-connected', { phone: phoneNumber });
    }

    if (connection === 'close') {
      connected = false;
      connecting = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('[Bridge] Connection closed, reconnect:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => connect(), 3000);
      } else {
        console.log('[Bridge] Logged out — delete auth dir to re-scan QR');
        currentQR = null;
      }
    }
  });

  sock.ev.on('messaging-history.set', ({ chats = [], contacts = [] }) => {
    for (const chat of chats) {
      rememberChat(chat.id, {
        name: chat.name || chat.subject,
        last_message_time: chat.conversationTimestamp ? normaliseTimestamp(chat.conversationTimestamp) : null,
      });
    }
    for (const contact of contacts) {
      rememberChat(contact.id, {
        name: contact.name || contact.notify || contact.verifiedName,
      });
    }
    saveKnownChats();
  });

  sock.ev.on('chats.upsert', (chats = []) => {
    for (const chat of chats) {
      rememberChat(chat.id, {
        name: chat.name || chat.subject,
        last_message_time: chat.conversationTimestamp ? normaliseTimestamp(chat.conversationTimestamp) : null,
      });
    }
    saveKnownChats();
  });

  sock.ev.on('chats.update', (chats = []) => {
    for (const chat of chats) {
      rememberChat(chat.id, {
        name: chat.name || chat.subject,
        last_message_time: chat.conversationTimestamp ? normaliseTimestamp(chat.conversationTimestamp) : null,
      });
    }
    saveKnownChats();
  });

  sock.ev.on('contacts.upsert', (contacts = []) => {
    for (const contact of contacts) {
      rememberChat(contact.id, {
        name: contact.name || contact.notify || contact.verifiedName,
      });
    }
    saveKnownChats();
  });

  sock.ev.on('contacts.update', (contacts = []) => {
    for (const contact of contacts) {
      rememberChat(contact.id, {
        name: contact.name || contact.notify || contact.verifiedName,
      });
    }
    saveKnownChats();
  });

  // ── Incoming messages ──────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const from = msg.key.remoteJid || '';
      const unwrappedMessage = unwrapMessage(msg.message || {});
      const body = extractBody(unwrappedMessage);

      if (!body && !unwrappedMessage?.orderMessage) continue;

      console.log(`[Bridge] MSG from ${from}: ${body.slice(0, 80)}`);
      rememberChat(from, {
        name: msg.pushName || from.split('@')[0],
        last_message_time: normaliseTimestamp(msg.messageTimestamp),
      });
      saveKnownChats();

      // Forward to Python backend
      await notifyPython('/api/whatsapp/incoming', {
        from,
        body,
        timestamp: normaliseTimestamp(msg.messageTimestamp),
        message_id: msg.key.id,
        order_data: unwrappedMessage?.orderMessage || null,
      });
    }
  });
}

// ── Forward events to Python ───────────────────────────────────────────────

async function notifyPython(endpoint, data) {
  try {
    await fetch(PYTHON_BACKEND + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error('[Bridge] notifyPython failed:', e.message);
  }
}

// ── HTTP API ────────────────────────────────────────────────────────────────

// Health / status check (used by Python bridge-status endpoint)
app.get('/', (req, res) => {
  res.json({ status: 'ok', connected, phone: phoneNumber });
});

app.get('/api/status', (req, res) => {
  res.json({
    connected,
    qr: currentQR || null,
    phone: phoneNumber,
    chats: knownChats.size,
    status: connected ? 'connected' : currentQR ? 'qr_pending' : 'offline',
  });
});

app.get('/api/chats', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const limit = Math.min(Number(req.query.limit || 100), 500);
  let chats = [...knownChats.values()];
  if (q) {
    chats = chats.filter((c) => `${c.name || ''} ${c.jid}`.toLowerCase().includes(q));
  }
  chats.sort((a, b) => String(b.last_message_time || '').localeCompare(String(a.last_message_time || '')));
  res.json({ chats: chats.slice(0, limit), total: chats.length });
});

// Send a message — called by Python backend
app.post('/api/send', async (req, res) => {
  const { recipient, message } = req.body;
  if (!recipient || !message) return res.status(400).json({ error: 'recipient and message required' });
  if (!connected || !sock) return res.status(503).json({ error: 'Not connected to WhatsApp' });

  try {
    const jid = recipient.includes('@') ? recipient : `${recipient}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    res.json({ status: 'sent' });
  } catch (e) {
    console.error('[Bridge] Send failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Start / restart connection
app.post('/api/connect', async (req, res) => {
  if (!connected) {
    connect().catch(console.error);
    res.json({ status: 'connecting' });
  } else {
    res.json({ status: 'already_connected', phone: phoneNumber });
  }
});

// Logout and delete session
app.post('/api/logout', async (req, res) => {
  try {
    if (sock) await sock.logout().catch(() => {});
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    connected = false;
    currentQR = null;
    phoneNumber = '';
    res.json({ status: 'logged_out' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[Bridge] HTTP API running on port ${PORT}`);
  connect().catch(console.error);
});
