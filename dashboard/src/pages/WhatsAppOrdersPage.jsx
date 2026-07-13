import { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'react-qr-code';
import { addOrder } from '../data/orders';
import { getProducts } from '../data/products';
import { toast } from '../components/Toast';

// In production VITE_API_URL points to the Render backend.
// In dev it's empty so calls go to the Vite proxy (or localhost via the proxy).
const BACKEND = import.meta.env.VITE_API_URL || '';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function truncate(t, n = 60) { return t && t.length > n ? t.slice(0, n) + '…' : (t || '—'); }

// ── QR Connect Screen ─────────────────────────────────────────────────────────

function QRConnectScreen({ onConnected }) {
  const [status, setStatus] = useState('starting'); // starting | qr | connected | error
  const [qrB64, setQrB64] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const pollRef = useRef(null);

  const checkStatus = useCallback(async () => {
    try {
      const d = await apiFetch('/api/whatsapp/bridge-status');
      if (d.connected) {
        setStatus('connected');
        clearInterval(pollRef.current);
        setTimeout(onConnected, 1200);
      } else if (d.qr_available && d.qr_b64) {
        setStatus('qr');
        setQrB64(d.qr_b64);
      } else if (d.bridge_running === false) {
        setStatus('error');
        setErrMsg('Bridge service is starting up on Render (30-60s cold start). It will appear automatically.');
      }
    } catch (e) {
      // Only surface polling errors after a few failed attempts to avoid noise during cold-start
      setStatus('error');
      setErrMsg(e?.message ? `Bridge unreachable: ${e.message}` : 'Bridge unreachable');
    }
  }, [onConnected]);

  useEffect(() => {
    checkStatus();
    pollRef.current = setInterval(checkStatus, 3000);
    return () => clearInterval(pollRef.current);
  }, [checkStatus]);

  // Note: no manual "Connect" button here. The QR appears automatically once the
  // remote Baileys bridge boots and emits its first QR (typically ≤10s). The old
  // handleStart() path called POST /start-bridge which is only valid when the
  // bridge runs in-process (local dev). On Render/Vercel it either no-ops or
  // errors, so removing the button prevents user-facing 500s.

  if (status === 'connected') return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', gap: 16 }}>
      <div style={{ fontSize: 64 }}>✅</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#166534' }}>WhatsApp Connected!</div>
      <div style={{ fontSize: 13, color: '#64748b' }}>Loading your dashboard…</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', gap: 0 }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 20, padding: 40, maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#25D36618', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 20px' }}>💬</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>Connect WhatsApp</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 28px', lineHeight: 1.6 }}>
          Scan the QR code with your WhatsApp app to enable real-time order scanning.
        </p>

        {status === 'starting' && (
          <div style={{ color: '#64748b', fontSize: 13 }}>
            <div style={{ width: 28, height: 28, border: '3px solid #e2e8f0', borderTop: '3px solid #25D366', borderRadius: '50%', animation: 'wa-spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            Loading QR… (Render free-tier can take up to 60s the first time)
          </div>
        )}

        {status === 'error' && (
          <div>
            <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 16px', textAlign: 'left', color: '#78350f', fontSize: 13, lineHeight: 1.6 }}>
              {errMsg}
            </div>
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <a href="/api/whatsapp/connect" target="_blank" rel="noreferrer"
                style={{ color: '#25D366', fontWeight: 600 }}>Open standalone QR page ↗</a>
            </div>
          </div>
        )}

        {status === 'qr' && qrB64 && (
          <div>
            <div style={{ background: '#fff', border: '2px solid #25D366', borderRadius: 12, padding: 12, display: 'inline-block', marginBottom: 16 }}>
              <QRCode
                value={qrB64.startsWith('qr:') ? qrB64.slice(3) : qrB64}
                size={280}
                level="L"
              />
            </div>
            <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
              Open WhatsApp → <strong>Linked Devices</strong> → <strong>Link a Device</strong> → Scan this code
            </div>
            <div style={{ marginTop: 10, fontSize: 12 }}>
              QR not scanning? <a href="/api/whatsapp/connect" target="_blank" rel="noreferrer"
                style={{ color: '#25D366', fontWeight: 600 }}>Open standalone QR page ↗</a>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>Checking connection every 3s…</div>
          </div>
        )}

        {status === 'serverless' && (
          <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 16px', textAlign: 'left', marginTop: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e', marginBottom: 6 }}>⚠️ Bridge can't run on this server</div>
            <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.7 }}>
              This app is deployed on a serverless platform (Vercel) which can't run the WhatsApp bridge.<br /><br />
              <strong>To fix:</strong> Deploy the <code>whatsapp-bridge/</code> folder to Railway or Render as a separate service, then add <code>WHATSAPP_BRIDGE_API=https://your-bridge-url</code> to your Vercel environment variables.<br /><br />
              For local testing, use <strong>localhost:5174</strong> — the bridge runs automatically there.
            </div>
          </div>
        )}

        {status !== 'qr' && status !== 'idle' && status !== 'serverless' && (
          <div style={{ marginTop: 20, fontSize: 12, color: '#94a3b8' }}>Auto-checking connection status…</div>
        )}
      </div>
      <style>{`@keyframes wa-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Add Chat Modal (Search) ───────────────────────────────────────────────────

function AddChatModal({ onClose, onAdded }) {
  const [tab, setTab] = useState('search'); // search | bulk
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [bulkText, setBulkText] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  const doSearch = async (q) => {
    setSearching(true);
    try {
      const d = await apiFetch(`/api/whatsapp/search-chats?q=${encodeURIComponent(q)}&limit=40`);
      setResults(d.chats || []);
    } catch { setResults([]); }
    setSearching(false);
  };

  useEffect(() => { doSearch(''); }, []);

  const onSearchChange = (e) => {
    const q = e.target.value;
    setSearchQ(q); setSelected(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => doSearch(q), 280);
  };

  const handleAddSingle = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const d = await apiFetch('/api/whatsapp/add-chat', {
        method: 'POST',
        body: JSON.stringify({ chat_name: selected.name || selected.jid, chat_jid: selected.jid, customer_name: selected.name || selected.jid }),
      });
      toast.success(`Monitoring: ${selected.name || selected.jid}`);
      onAdded([d.chat]);
      onClose();
    } catch (e) { toast.error(e.message || 'Failed to add'); }
    setLoading(false);
  };

  const handleBulkAdd = async () => {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const chats = lines.map(l => {
      const isJid = l.includes('@');
      return { chat_jid: isJid ? l : `${l.replace(/\D/g, '')}@s.whatsapp.net`, chat_name: l, customer_name: l };
    });
    setLoading(true);
    try {
      const d = await apiFetch('/api/whatsapp/bulk-add-chats', {
        method: 'POST',
        body: JSON.stringify({ chats }),
      });
      toast.success(`Added ${d.added} chat(s), skipped ${d.skipped} duplicates`);
      onAdded(d.chats || []);
      onClose();
    } catch (e) { toast.error(e.message || 'Bulk add failed'); }
    setLoading(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 520, background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#25D36618', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>💬</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Add Customers to Monitor</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Search chats or paste a list of contacts</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#64748b' }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0' }}>
          {[['search', '🔍 Search Chats'], ['bulk', '📋 Bulk Add']].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '10px 0', fontSize: 13, fontWeight: tab === t ? 700 : 500,
              color: tab === t ? '#3b82f6' : '#64748b', background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ padding: 20 }}>
          {tab === 'search' && (
            <>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input className="form-input" value={searchQ} onChange={onSearchChange} placeholder="Search by name or number…"
                  style={{ width: '100%', boxSizing: 'border-box' }} autoFocus />
                {searching && <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 12 }}>⟳</div>}
              </div>
              {results.length > 0 && !selected && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
                  {results.map((c, i) => (
                    <div key={c.jid} onClick={() => { setSelected(c); setSearchQ(c.name || c.jid); setResults([]); }}
                      style={{ padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: i < results.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#25D36615', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
                        {c.jid?.endsWith('@g.us') ? '👥' : '👤'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name || '(no name)'}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.jid}</div>
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{c.jid?.endsWith('@g.us') ? 'Group' : 'Contact'}</div>
                    </div>
                  ))}
                </div>
              )}
              {selected && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span>✅</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{selected.name || selected.jid}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Scanned every 2 minutes for order intent</div>
                  </div>
                  <button onClick={() => { setSelected(null); setSearchQ(''); doSearch(''); }}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16 }}>✕</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={handleAddSingle} disabled={loading || !selected}
                  style={{ background: selected ? '#25D366' : undefined, borderColor: selected ? '#25D366' : undefined }}>
                  {loading ? 'Adding…' : '💬 Monitor This Chat'}
                </button>
              </div>
            </>
          )}

          {tab === 'bulk' && (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, lineHeight: 1.6 }}>
                Paste one contact/number per line. Phone numbers are auto-converted to JIDs.<br />
                <span style={{ fontStyle: 'italic' }}>e.g. "Priya Sharma" or "919876543210"</span>
              </div>
              <textarea value={bulkText} onChange={e => setBulkText(e.target.value)}
                placeholder={"Priya Sharma\nRajesh Kumar\n919876543210\n919123456789"}
                style={{ width: '100%', boxSizing: 'border-box', height: 160, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={handleBulkAdd}
                  disabled={loading || !bulkText.trim()}
                  style={{ background: '#25D366', borderColor: '#25D366' }}>
                  {loading ? 'Adding…' : `Add ${bulkText.split('\n').filter(l => l.trim()).length} Contact(s)`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Draft Replies Panel ───────────────────────────────────────────────────────

function DraftRepliesPanel({ onOrderCreated }) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  const loadReplies = useCallback(async () => {
    try {
      const d = await apiFetch('/api/whatsapp/draft-replies');
      setReplies(d.replies || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadReplies();
    const t = setInterval(loadReplies, 10000);
    return () => clearInterval(t);
  }, [loadReplies]);

  const handleSend = async (reply) => {
    setLoading(reply.id);
    try {
      await apiFetch('/api/whatsapp/send-reply', {
        method: 'POST',
        body: JSON.stringify({ reply_id: reply.id }),
      });
      toast.success(`Message sent to ${reply.customer_name}`);
      loadReplies();
    } catch (e) { toast.error(e.message || 'Send failed'); }
    setLoading(false);
  };

  const handleSkip = async (reply) => {
    try {
      await apiFetch('/api/whatsapp/skip-reply', {
        method: 'POST',
        body: JSON.stringify({ reply_id: reply.id }),
      });
      loadReplies();
    } catch { /* ignore */ }
  };

  const handleCheckConfirmations = async () => {
    setChecking(true);
    try {
      const d = await apiFetch('/api/whatsapp/check-confirmations', { method: 'POST' });
      if (d.confirmed > 0) {
        // Create orders in localStorage
        for (const o of (d.orders_created || [])) {
          addOrder(o.localStorage_payload || o);
        }
        toast.success(`${d.confirmed} customer(s) confirmed! Orders created.`);
        onOrderCreated();
      } else {
        toast.info(`Checked ${d.checked} chat(s) — no confirmations yet`);
      }
      loadReplies();
    } catch (e) { toast.error(e.message || 'Check failed'); }
    setChecking(false);
  };

  const pending = replies.filter(r => r.status === 'draft');
  const sent = replies.filter(r => r.status === 'sent');

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 24, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>💬 Draft Replies</div>
          {pending.length > 0 && (
            <span style={{ background: '#fef9c3', color: '#854d0e', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
              {pending.length} pending
            </span>
          )}
        </div>
        <button onClick={handleCheckConfirmations} disabled={checking}
          style={{ fontSize: 12, padding: '6px 12px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
          {checking ? '⟳ Checking…' : '✅ Check Customer Replies'}
        </button>
      </div>

      {replies.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
          No draft replies yet. Scan chats to detect orders and auto-draft messages.
        </div>
      ) : (
        <div>
          {replies.map((reply, i) => (
            <div key={reply.id} style={{
              padding: '14px 20px',
              borderBottom: i < replies.length - 1 ? '1px solid #f1f5f9' : 'none',
              background: reply.status === 'sent' ? '#fafafa' : '#fff',
              display: 'flex', alignItems: 'flex-start', gap: 14,
            }}>
              {/* Avatar */}
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: reply.product_available ? '#25D36618' : '#fee2e218', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                {reply.product_available ? '✅' : '❌'}
              </div>
              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{reply.customer_name}</span>
                  <span style={{ fontSize: 11, background: reply.product_available ? '#dcfce7' : '#fee2e2', color: reply.product_available ? '#166534' : '#991b1b', borderRadius: 20, padding: '2px 8px', fontWeight: 600 }}>
                    {reply.product_available ? '✅ Available' : '❌ Out of Stock'}
                  </span>
                  {reply.product_name && (
                    <span style={{ fontSize: 11, background: '#eff6ff', color: '#3b82f6', borderRadius: 20, padding: '2px 8px', fontWeight: 600 }}>
                      {reply.product_name} {reply.product_price ? `· ₹${reply.product_price}` : ''}
                    </span>
                  )}
                  {reply.status === 'sent' && (
                    <span style={{ fontSize: 11, color: '#25D366', fontWeight: 600 }}>✓ Sent {fmt(reply.sent_at)}</span>
                  )}
                  {reply.status === 'skipped' && (
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>Skipped</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {reply.message_text}
                </div>
              </div>
              {/* Actions */}
              {reply.status === 'draft' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => handleSend(reply)} disabled={loading === reply.id}
                    style={{ fontSize: 12, padding: '6px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {loading === reply.id ? 'Sending…' : '📤 Send'}
                  </button>
                  <button onClick={() => handleSkip(reply)}
                    style={{ fontSize: 12, padding: '6px 14px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Skip
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function ScanCountdown() {
  const [secs, setSecs] = useState(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const d = await apiFetch('/api/whatsapp/next-scan-in');
        setSecs(d.seconds);
      } catch { setSecs(null); }
    };
    fetch();
    const t = setInterval(fetch, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (secs === null || secs <= 0) return;
    const t = setInterval(() => setSecs(s => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [secs]);

  if (secs === null) return <span>—</span>;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return <span>{m}m {String(s).padStart(2, '0')}s</span>;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WhatsAppOrdersPage() {
  const [waConnected, setWaConnected] = useState(null); // null=loading, false=needs QR, true=connected
  const [chats, setChats] = useState([]);
  const [orders, setOrders] = useState([]);
  const [showAddChat, setShowAddChat] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Check bridge status on load + sync local product catalog to backend
  useEffect(() => {
    apiFetch('/api/whatsapp/bridge-status')
      .then(d => setWaConnected(d.connected || d.authenticated))
      .catch(() => setWaConnected(false));

    // Push localStorage products to backend so scan uses real catalog
    const products = getProducts();
    if (products.length > 0) {
      apiFetch('/api/whatsapp/sync-products', {
        method: 'POST',
        body: JSON.stringify({ products }),
      }).catch(() => {});
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([
        apiFetch('/api/whatsapp/chats'),
        apiFetch('/api/whatsapp/detected-orders'),
      ]);
      setChats(c.chats || []);
      setOrders(o.orders || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (waConnected) loadData();
  }, [waConnected, loadData]);

  // Auto-refresh
  useEffect(() => {
    if (!waConnected) return;
    const t = setInterval(loadData, 12000);
    return () => clearInterval(t);
  }, [waConnected, loadData]);

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const res = await apiFetch('/api/whatsapp/scan', { method: 'POST' });
      toast.success(`Scanned ${res.scanned_chats} chat(s) — ${res.new_detections} new intent(s)`);
      await loadData();
    } catch (e) { toast.error(e.message || 'Scan failed'); }
    setScanning(false);
  };

  const handleRemoveChat = async (jid) => {
    try {
      await apiFetch(`/api/whatsapp/chats/${encodeURIComponent(jid)}`, { method: 'DELETE' });
      setChats(c => c.filter(ch => ch.chat_jid !== jid));
      toast.info('Removed from monitoring');
    } catch (e) { toast.error(e.message); }
  };

  const handleConfirmOrder = async (order) => {
    try {
      const res = await apiFetch('/api/whatsapp/confirm-order', {
        method: 'POST',
        body: JSON.stringify({ order_id: order.id }),
      });
      addOrder(res.localStorage_payload);
      toast.success(`Order confirmed for ${order.customer_name}`);
      loadData();
    } catch (e) { toast.error(e.message); }
  };

  const handleRejectOrder = async (order) => {
    try {
      await apiFetch('/api/whatsapp/reject-order', { method: 'POST', body: JSON.stringify({ order_id: order.id }) });
      toast.info('Order rejected');
      loadData();
    } catch (e) { toast.error(e.message); }
  };

  // Loading
  if (waConnected === null) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', color: '#64748b', fontSize: 14 }}>
      Checking WhatsApp connection…
    </div>
  );

  // Step 1: Not connected — show QR
  if (!waConnected) return (
    <div style={{ padding: 24, background: '#f8f9fa', minHeight: '100%' }}>
      <QRConnectScreen onConnected={() => setWaConnected(true)} />
      <style>{`@keyframes wa-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const pending = orders.filter(o => o.status === 'pending');
  const confirmedToday = orders.filter(o => {
    if (o.status !== 'confirmed') return false;
    return new Date(o.confirmed_at || o.detected_at).toDateString() === new Date().toDateString();
  });

  return (
    <div style={{ padding: 24, maxWidth: 1100, background: '#f8f9fa', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', margin: 0 }}>WhatsApp Orders</h1>
            <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>● Connected</span>
          </div>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            Auto-scans every 2 min · Next scan in <strong><ScanCountdown /></strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowAddChat(true)}>+ Add Customers</button>
          <button className="btn btn-primary" onClick={handleScanNow} disabled={scanning || chats.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {scanning
              ? <><div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.4)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'wa-spin 0.7s linear infinite' }} />Scanning…</>
              : '🔄 Scan Now'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Monitored Chats', value: chats.length, icon: '💬', color: '#3b82f6' },
          { label: 'Pending Replies', value: pending.length, icon: '⏳', color: '#f59e0b' },
          { label: 'Confirmed Today', value: confirmedToday.length, icon: '✅', color: '#22c55e' },
          { label: 'Total Detected', value: orders.length, icon: '🔍', color: '#8b5cf6' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: s.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {chats.length === 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '48px 32px', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b', marginBottom: 8 }}>Add your customers</div>
          <div style={{ fontSize: 13, color: '#64748b', maxWidth: 400, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Add WhatsApp chats or groups to monitor. Messages are automatically scanned every 2 minutes for order keywords matched against your product catalog.
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddChat(true)}
            style={{ background: '#25D366', borderColor: '#25D366' }}>
            + Add Customers
          </button>
        </div>
      )}

      {/* Monitored Chats */}
      {chats.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 24, overflow: 'hidden' }}>
          <div style={{ padding: '13px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Monitored Chats & Groups</div>
            <button className="btn btn-secondary" onClick={() => setShowAddChat(true)} style={{ fontSize: 12, padding: '5px 10px' }}>+ Add More</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Customer / Group', 'Type', 'Last Scanned', 'Detections', ''].map(h => (
                  <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chats.map((chat, i) => (
                <tr key={chat.chat_jid} style={{ borderBottom: i < chats.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{chat.customer_name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{truncate(chat.chat_jid, 36)}</div>
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{ fontSize: 11, background: chat.chat_jid?.endsWith('@g.us') ? '#eff6ff' : '#f0fdf4', color: chat.chat_jid?.endsWith('@g.us') ? '#3b82f6' : '#166534', borderRadius: 20, padding: '2px 8px', fontWeight: 600 }}>
                      {chat.chat_jid?.endsWith('@g.us') ? '👥 Group' : '👤 Contact'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: '#64748b' }}>{fmt(chat.last_scanned)}</td>
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{ background: '#eff6ff', color: '#3b82f6', borderRadius: 20, padding: '2px 10px', fontWeight: 600, fontSize: 12 }}>
                      {chat.order_count || 0}
                    </span>
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    <button onClick={() => handleRemoveChat(chat.chat_jid)}
                      style={{ fontSize: 11, padding: '4px 10px', background: '#fee2e2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Draft Replies */}
      {chats.length > 0 && <DraftRepliesPanel onOrderCreated={loadData} />}

      {/* Detected Orders */}
      {orders.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '13px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Detected Order Intents</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ background: '#fef9c3', color: '#854d0e', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{pending.length} pending</span>
              <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{orders.filter(o => o.status === 'confirmed').length} confirmed</span>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Customer', 'Message', 'Product', 'Qty', 'Price', 'Conf.', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={o.id} style={{ borderBottom: i < orders.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ padding: '11px 14px', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{o.customer_name}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: '#475569', maxWidth: 200 }}>
                      <span title={o.message_text}>{truncate(o.message_text, 50)}</span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 12 }}>{o.product_hint || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>{o.qty}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#059669', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {o.price ? `₹${Number(o.price).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                      <div style={{ width: 50, background: '#e2e8f0', borderRadius: 4, height: 5 }}>
                        <div style={{ width: `${(o.confidence || 0) * 100}%`, background: o.confidence > 0.7 ? '#22c55e' : '#f59e0b', height: '100%', borderRadius: 4 }} />
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{Math.round((o.confidence || 0) * 100)}%</div>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{
                        background: o.status === 'confirmed' ? '#dcfce7' : o.status === 'rejected' ? '#fee2e2' : '#fef9c3',
                        color: o.status === 'confirmed' ? '#166534' : o.status === 'rejected' ? '#991b1b' : '#854d0e',
                        borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600,
                      }}>
                        {o.status === 'confirmed' ? '✅ Confirmed' : o.status === 'rejected' ? '❌ Rejected' : '⏳ Pending'}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      {o.status === 'pending' ? (
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button onClick={() => handleConfirmOrder(o)}
                            style={{ fontSize: 11, padding: '4px 9px', background: '#dcfce7', color: '#166534', border: '1px solid rgba(22,101,52,0.2)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>✅</button>
                          <button onClick={() => handleRejectOrder(o)}
                            style={{ fontSize: 11, padding: '4px 9px', background: '#fee2e2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>❌</button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{fmt(o.confirmed_at || o.rejected_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddChat && <AddChatModal onClose={() => setShowAddChat(false)} onAdded={newChats => setChats(c => [...c, ...newChats])} />}
      <style>{`@keyframes wa-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
