import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { toast } from '../components/Toast';
import { getProducts, saveProducts, addProduct, updateProduct, deleteProduct, EXCEL_COLUMNS } from '../data/products';

const BACKEND = '';

// ── Share on WhatsApp modal ───────────────────────────────────────────────────

function ShareWhatsAppModal({ product, onClose }) {
  const [chats, setChats] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [template, setTemplate] = useState('offer');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${BACKEND}/api/whatsapp/available-chats?limit=100`)
      .then(r => r.json())
      .then(d => setChats(d.chats || []))
      .catch(() => {});
  }, []);

  const toggle = jid => setSelected(s => {
    const n = new Set(s);
    n.has(jid) ? n.delete(jid) : n.add(jid);
    return n;
  });

  const handleSend = async () => {
    if (!selected.size) return;
    setSending(true);
    try {
      const res = await fetch(`${BACKEND}/api/whatsapp/broadcast-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jids: [...selected],
          message: buildMessage(),
          product_name: product.name,
          price: Number(product.price),
          track_reply: true,
        }),
      });
      const data = await res.json();
      setSent(true);
      toast.success(`Sent to ${data.sent} recipient${data.sent !== 1 ? 's' : ''}`);
    } catch (e) {
      toast.error('Send failed — check WhatsApp is connected');
    }
    setSending(false);
  };

  const buildMessage = () => {
    const price = Number(product.price);
    const mrp = Number(product.mrp);
    const discount = mrp > price ? ` ~~₹${mrp.toLocaleString('en-IN')}~~ →` : '';
    const templates = {
      offer: `Hi {name}! 👋\n\nWe have an exciting offer!\n\n🛍️ *${product.name}*\n${discount} *₹${price.toLocaleString('en-IN')}*\n\nReply *YES* to order. 🚀`,
      restock: `Hi {name}! 😊\n\n*${product.name}* is back in stock!\n\nPrice: *₹${price.toLocaleString('en-IN')}*\n\nReply *YES* to reserve. 📦`,
      new_launch: `Hi {name}! 🎉\n\nNew launch — *${product.name}*!\n\nIntroductory price: *₹${price.toLocaleString('en-IN')}*\n\nReply *BUY* to order! 🛒`,
    };
    return templates[template] || templates.offer;
  };

  const filtered = chats.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase())
  );

  if (sent) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 400, background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Sent!</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Replies will appear as orders automatically.</div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onClose}>Done</button>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 520, maxHeight: '85vh', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#25D36618', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Share on WhatsApp</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{product.name} · ₹{Number(product.price).toLocaleString('en-IN')}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-secondary)', padding: 4 }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: 20 }}>
          {/* Message template */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Message type</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['offer', '🔥 Offer'], ['restock', '📦 Back in Stock'], ['new_launch', '🚀 New Launch']].map(([key, label]) => (
                <button key={key} onClick={() => setTemplate(key)}
                  style={{ fontSize: 12, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', border: '1.5px solid', borderColor: template === key ? '#25D366' : 'var(--border)', background: template === key ? '#25D36618' : 'transparent', color: template === key ? '#25D366' : 'var(--text-secondary)', fontWeight: template === key ? 600 : 400 }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div style={{ background: '#dcf8c6', borderRadius: 12, padding: '10px 14px', fontSize: 13, lineHeight: 1.6, marginBottom: 16, whiteSpace: 'pre-line', maxHeight: 120, overflow: 'hidden' }}>
            {buildMessage().replace('{name}', 'Customer')}
          </div>

          {/* Recipients */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Send to · {selected.size > 0 && <span style={{ color: '#25D366' }}>{selected.size} selected</span>}
          </div>
          <input
            className="form-input"
            placeholder="Search contacts and groups…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }}
          />
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
              {chats.length === 0 ? 'Connect WhatsApp Business in Integrations first' : 'No contacts match'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filtered.map(c => (
                <div key={c.jid} onClick={() => toggle(c.jid)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: selected.has(c.jid) ? '#25D36610' : 'transparent', border: `1px solid ${selected.has(c.jid) ? '#25D366' : 'var(--border)'}`, transition: 'all 0.1s' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: c.is_group ? '#3395FF20' : '#25D36620', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                    {c.is_group ? '👥' : '👤'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    {c.phone && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.phone}</div>}
                    {c.is_group && <div style={{ fontSize: 11, color: 'var(--blue)' }}>Group</div>}
                  </div>
                  {selected.has(c.jid) && <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                  </div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button onClick={handleSend} disabled={sending || !selected.size}
            style={{ width: '100%', padding: '12px 0', background: selected.size ? '#25D366' : 'var(--border)', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: selected.size ? 'pointer' : 'default', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {sending ? 'Sending…' : selected.size ? `Send to ${selected.size} recipient${selected.size !== 1 ? 's' : ''}` : 'Select recipients above'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StockBadge({ stock }) {
  if (stock === 0) return <span style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', background: '#FEE2E2', padding: '2px 8px', borderRadius: 4 }}>Out of stock</span>;
  if (stock <= 5) return <span style={{ fontSize: 11, fontWeight: 600, color: '#D97706', background: '#FEF3C7', padding: '2px 8px', borderRadius: 4 }}>Low · {stock}</span>;
  return <span style={{ fontSize: 11, fontWeight: 600, color: '#065F46', background: '#D1FAE5', padding: '2px 8px', borderRadius: 4 }}>{stock} in stock</span>;
}

// ── Add / Edit Product Form ───────────────────────────────────────────────────

const EMPTY_FORM = { name: '', sku: '', ean: '', price: '', mrp: '', stock: '', category: '', weight: '' };

// ── PDF Import Modal ──────────────────────────────────────────────────────────

function PdfImportModal({ onClose, onImported }) {
  const [step, setStep] = useState('upload'); // upload | preview | saving | done
  const [dragging, setDragging] = useState(false);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const handleFile = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file');
      return;
    }
    setError('');
    setStep('loading');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${BACKEND}/api/catalog/import/pdf/preview`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to parse PDF');
      setProducts(data.preview.map((p, i) => ({ ...p, _id: i, _keep: true })));
      setStep('preview');
    } catch (e) {
      setError(e.message);
      setStep('upload');
    }
  };

  const handleDrop = e => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const updateProduct = (id, field, value) =>
    setProducts(ps => ps.map(p => p._id === id ? { ...p, [field]: value } : p));

  const handleConfirm = async () => {
    setSaving(true);
    const toSave = products.filter(p => p._keep);
    try {
      const res = await fetch(`${BACKEND}/api/catalog/import/pdf/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: toSave }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      onImported(data.created);
      setStep('done');
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  const kept = products.filter(p => p._keep).length;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={step !== 'loading' && step !== 'saving' ? onClose : undefined}>
      <div onClick={e => e.stopPropagation()} style={{ width: step === 'preview' ? 720 : 480, maxHeight: '88vh', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#ef444418', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📄</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Import PDF Catalog</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>
              {step === 'upload' && 'Upload any PDF catalog — we extract the products automatically'}
              {step === 'loading' && 'Reading your catalog…'}
              {step === 'preview' && `${products.length} products found · ${kept} selected`}
              {step === 'done' && 'Import complete!'}
            </div>
          </div>
          {step !== 'loading' && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-secondary)', padding: 4 }}>×</button>}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: step === 'preview' ? 0 : 24 }}>

          {/* Upload step */}
          {(step === 'upload' || step === 'loading') && (
            <div>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => step === 'upload' && fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? 'var(--blue)' : 'var(--border)'}`,
                  borderRadius: 12, padding: '48px 32px', textAlign: 'center', cursor: step === 'upload' ? 'pointer' : 'default',
                  background: dragging ? '#f0f7ff' : 'var(--surface-2)', transition: 'all 0.15s',
                }}>
                {step === 'loading' ? (
                  <>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>Extracting products…</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>Reading your catalog, this takes a few seconds</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 44, marginBottom: 12 }}>📄</div>
                    <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Drop your PDF catalog here</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>or click to browse · Max 20MB</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      {['Price lists', 'Product brochures', 'Wholesale catalogs', 'Rate cards'].map(t => (
                        <span key={t} style={{ background: '#eff6ff', color: 'var(--blue)', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 500 }}>{t}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
              {error && <div style={{ background: 'var(--red-light)', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginTop: 12 }}>{error}</div>}
            </div>
          )}

          {/* Preview step */}
          {step === 'preview' && (
            <div>
              <div style={{ padding: '12px 20px', background: '#f0f9ff', borderBottom: '1px solid #bae6fd', fontSize: 13, color: '#0369a1', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>✅ Review and edit before saving. Uncheck products you don't want.</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '8px 12px', width: 36 }}></th>
                      {['Product Name', 'SKU', 'Price (₹)', 'MRP (₹)', 'Category'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p._id} style={{ borderBottom: '1px solid var(--border)', opacity: p._keep ? 1 : 0.4 }}>
                        <td style={{ padding: '6px 12px' }}>
                          <input type="checkbox" checked={!!p._keep} onChange={e => updateProduct(p._id, '_keep', e.target.checked)} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input value={p.name} onChange={e => updateProduct(p._id, 'name', e.target.value)}
                            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', fontSize: 12, fontFamily: 'inherit' }} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input value={p.sku || ''} onChange={e => updateProduct(p._id, 'sku', e.target.value)}
                            style={{ width: 90, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', fontSize: 12, fontFamily: 'monospace' }} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input type="number" value={p.price || ''} onChange={e => updateProduct(p._id, 'price', e.target.value)}
                            style={{ width: 80, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', fontSize: 12, fontFamily: 'inherit' }} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input type="number" value={p.mrp || ''} onChange={e => updateProduct(p._id, 'mrp', e.target.value)}
                            style={{ width: 80, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', fontSize: 12, fontFamily: 'inherit' }} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input value={p.category || ''} onChange={e => updateProduct(p._id, 'category', e.target.value)}
                            style={{ width: 100, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', fontSize: 12, fontFamily: 'inherit' }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error && <div style={{ background: 'var(--red-light)', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', fontSize: 13, margin: '12px 20px' }}>{error}</div>}
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '32px 24px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Products added!</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
                They're now in your catalog with a Share button on each one.
              </div>
              <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={onClose}>View catalog</button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'preview' && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={() => setStep('upload')}>← Re-upload</button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={saving || kept === 0}
              style={{ gap: 6, minWidth: 160, justifyContent: 'center' }}>
              {saving ? 'Saving…' : `Add ${kept} product${kept !== 1 ? 's' : ''} to catalog`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FormField({ label, k, type = 'text', required, placeholder, hint, value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>
        {label}{required && <span style={{ color: 'var(--red)' }}> *</span>}
      </label>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginBottom: 3 }}>{hint}</div>}
      <input className="form-input" type={type} value={value || ''} onChange={onChange} placeholder={placeholder} style={{ width: '100%', boxSizing: 'border-box' }} />
    </div>
  );
}

function ProductForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Product name is required'); return; }
    if (!form.sku.trim()) { toast.error('SKU is required'); return; }
    if (!form.price || isNaN(Number(form.price))) { toast.error('Valid selling price is required'); return; }
    if (!form.stock || isNaN(Number(form.stock))) { toast.error('Stock quantity is required'); return; }
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FormField label="Product Name" k="name" required placeholder="Handcrafted Brass Diya Set" value={form.name} onChange={set('name')} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label="SKU" k="sku" required placeholder="DIYA-BRASS-001" hint="Unique identifier for your inventory" value={form.sku} onChange={set('sku')} />
        <FormField label="EAN / Barcode" k="ean" placeholder="8901234567890" hint="13-digit barcode (optional)" value={form.ean} onChange={set('ean')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <FormField label="Selling Price (₹)" k="price" type="number" required placeholder="1299" value={form.price} onChange={set('price')} />
        <FormField label="MRP (₹)" k="mrp" type="number" placeholder="1499" value={form.mrp} onChange={set('mrp')} />
        <FormField label="Stock Qty" k="stock" type="number" required placeholder="50" value={form.stock} onChange={set('stock')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
        <FormField label="Category" k="category" placeholder="Home Decor" value={form.category} onChange={set('category')} />
        <FormField label="Weight (grams)" k="weight" type="number" placeholder="350" hint="Used for shipping rate calculation" value={form.weight} onChange={set('weight')} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">{initial ? 'Save changes' : 'Add product'}</button>
      </div>
    </form>
  );
}

// ── Excel Import ──────────────────────────────────────────────────────────────

function ImportModal({ onClose, onImported }) {
  const fileRef = useRef();
  const [preview, setPreview] = useState(null); // { rows, errors }
  const [importing, setImporting] = useState(false);

  const handleFile = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (raw.length === 0) { toast.error('Sheet is empty'); return; }

        // Map columns flexibly (case-insensitive)
        const colMap = {};
        const firstRow = raw[0];
        Object.keys(firstRow).forEach(col => {
          const lower = col.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (lower.includes('name') || lower.includes('product')) colMap.name = col;
          else if (lower.includes('sku')) colMap.sku = col;
          else if (lower.includes('ean') || lower.includes('barcode')) colMap.ean = col;
          else if (lower.includes('sell') || lower.includes('price')) colMap.price = col;
          else if (lower.includes('mrp')) colMap.mrp = col;
          else if (lower.includes('stock') || lower.includes('qty') || lower.includes('quantity')) colMap.stock = col;
          else if (lower.includes('cat')) colMap.category = col;
          else if (lower.includes('weight')) colMap.weight = col;
        });

        const errors = [];
        if (!colMap.name) errors.push('Missing column: Product Name');
        if (!colMap.sku) errors.push('Missing column: SKU');
        if (!colMap.price) errors.push('Missing column: Selling Price');
        if (!colMap.stock) errors.push('Missing column: Stock Qty');

        const rows = raw.slice(0, 5).map((r, i) => ({
          name: r[colMap.name] || '',
          sku: r[colMap.sku] || '',
          ean: r[colMap.ean] || '',
          price: r[colMap.price] || '',
          mrp: r[colMap.mrp] || '',
          stock: r[colMap.stock] || '',
          category: r[colMap.category] || '',
          weight: r[colMap.weight] || '',
          _row: i + 2,
          _valid: !!(r[colMap.name] && r[colMap.sku] && r[colMap.price] && r[colMap.stock]),
        }));

        setPreview({ rows, errors, total: raw.length, colMap, allRows: raw });
      } catch (err) {
        toast.error('Could not read file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = () => {
    if (!preview) return;
    setImporting(true);
    const { colMap, allRows } = preview;
    const products = getProducts();
    let added = 0, skipped = 0;

    allRows.forEach(r => {
      const name = String(r[colMap.name] || '').trim();
      const sku = String(r[colMap.sku] || '').trim();
      const price = Number(r[colMap.price] || 0);
      const stock = Number(r[colMap.stock] || 0);
      if (!name || !sku || !price) { skipped++; return; }
      // Skip duplicate SKUs
      if (products.find(p => p.sku === sku)) { skipped++; return; }
      products.unshift({
        id: `PRD-${Date.now()}-${added}`,
        name, sku,
        ean: String(r[colMap.ean] || ''),
        price,
        mrp: Number(r[colMap.mrp] || price),
        stock,
        category: String(r[colMap.category] || ''),
        weight: Number(r[colMap.weight] || 0),
        createdAt: new Date().toISOString(),
      });
      added++;
    });

    saveProducts(products);
    setImporting(false);
    toast.success(`Imported ${added} products${skipped ? `, skipped ${skipped} (missing fields or duplicate SKU)` : ''}`);
    onImported();
    onClose();
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      EXCEL_COLUMNS.map(c => c.label),
      ['Handcrafted Brass Diya Set', 'DIYA-BRASS-001', '8901234567890', '1299', '1499', '50', 'Home Decor', '350'],
      ['Organic Ashwagandha Capsules 60ct', 'ASHW-CAP-060', '8902345678901', '649', '799', '120', 'Health & Wellness', '180'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, 'd2cflow_products_template.xlsx');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="animate-in"
        style={{ width: 600, background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Import Products from Excel</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Upload a .xlsx file to bulk-add your product catalog</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>
          {/* Template download */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Download template first</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                Required columns: {EXCEL_COLUMNS.filter(c => c.required).map(c => c.label).join(', ')}
              </div>
            </div>
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={downloadTemplate}>
              ↓ Download .xlsx template
            </button>
          </div>

          {/* File upload */}
          <div
            onClick={() => fileRef.current?.click()}
            style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius)', padding: '32px 24px', textAlign: 'center', cursor: 'pointer', marginBottom: 20, transition: 'border-color 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--blue)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Click to upload Excel file</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>.xlsx or .xls — max 10,000 rows</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} />
          </div>

          {/* Preview */}
          {preview && (
            <div>
              {preview.errors.length > 0 && (
                <div style={{ padding: '10px 14px', background: 'var(--red-light)', borderRadius: 'var(--radius)', border: '1px solid rgba(220,38,38,0.2)', marginBottom: 16 }}>
                  {preview.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--red)' }}>⚠ {e}</div>)}
                </div>
              )}

              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                Preview — first 5 of {preview.total} rows
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'auto', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      {['Name', 'SKU', 'Price', 'Stock', 'Category'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                      <th style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 10px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name || '—'}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: 'var(--blue)' }}>{row.sku || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>₹{row.price || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>{row.stock || '—'}</td>
                        <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{row.category || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>
                          {row._valid
                            ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓</span>
                            : <span style={{ color: 'var(--red)', fontWeight: 600 }}>✗</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.errors.length === 0 && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
                    {importing ? 'Importing…' : `Import all ${preview.total} products`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [products, setProducts] = useState(getProducts);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [showPdfImport, setShowPdfImport] = useState(false);

  const refresh = () => setProducts(getProducts());

  // Hydrate from backend on mount — Supabase is source of truth
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BACKEND}/api/whatsapp/products`);
        const data = await res.json();
        if (cancelled || !data?.products) return;
        // Merge backend products into localStorage, preserving user-added ones (matched by sku)
        const local = getProducts();
        const bySku = new Map(local.map(p => [p.sku, p]));
        for (const p of data.products) {
          bySku.set(p.sku, {
            id: p.id || `PRD-${p.sku}`,
            name: p.name,
            sku: p.sku,
            price: p.price || 0,
            mrp: p.price || 0,
            stock: p.stock || 0,
            source: 'backend',
            ...bySku.get(p.sku),   // preserve any local overrides
            // but always take latest price/stock from backend
            price: p.price || 0,
            stock: p.stock || 0,
          });
        }
        const merged = Array.from(bySku.values());
        saveProducts(merged);
        setProducts(merged);
      } catch (e) {
        console.warn('Products hydration failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleAdd = form => {
    addProduct(form);
    refresh();
    setShowAdd(false);
    toast.success('Product added to catalog');
  };

  const handleUpdate = form => {
    updateProduct(editing.id, {
      ...form,
      price: Number(form.price),
      mrp: Number(form.mrp),
      stock: Number(form.stock),
      weight: Number(form.weight),
    });
    refresh();
    setEditing(null);
    toast.success('Product updated');
  };

  const handleDelete = id => {
    deleteProduct(id);
    refresh();
    setConfirmDelete(null);
    toast.info('Product removed from catalog');
  };

  const filtered = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    (p.ean || '').includes(search) ||
    (p.category || '').toLowerCase().includes(search.toLowerCase())
  );

  // Empty state
  if (products.length === 0 && !showAdd) {
    return (
      <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 52px)' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>📦</div>
        <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>No products yet</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 380, marginBottom: 32, lineHeight: 1.6 }}>
          Add your product catalog before creating orders. You can add products one by one or bulk-import from Excel.
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" style={{ fontSize: 13, gap: 7 }} onClick={() => setShowImport(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M17 8l-5-5-5 5 M12 3v12"/></svg>
            Import from Excel
          </button>
          <button className="btn btn-primary" style={{ fontSize: 13, gap: 7 }} onClick={() => setShowAdd(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14 M5 12h14"/></svg>
            Add product manually
          </button>
        </div>
        {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={refresh} />}
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Products</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {products.length} product{products.length !== 1 ? 's' : ''} in catalog
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" style={{ fontSize: 12, gap: 6 }} onClick={() => setShowPdfImport(true)}>
            📄 Import PDF
          </button>
          <button className="btn btn-secondary" style={{ fontSize: 12, gap: 6 }} onClick={() => setShowImport(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M17 8l-5-5-5 5 M12 3v12"/></svg>
            Import Excel
          </button>
          <button className="btn btn-primary" style={{ fontSize: 12, gap: 6 }} onClick={() => setShowAdd(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14 M5 12h14"/></svg>
            Add product
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input className="form-input" placeholder="Search by name, SKU, EAN…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ paddingLeft: 30, width: 300 }} />
      </div>

      {/* Add product inline */}
      {showAdd && (
        <div className="card" style={{ padding: 20, marginBottom: 20, border: '1px solid var(--blue)', boxShadow: '0 0 0 3px rgba(51,149,255,0.1)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: 'var(--blue)' }}>+ New Product</div>
          <ProductForm onSave={handleAdd} onCancel={() => setShowAdd(false)} />
        </div>
      )}

      {/* Edit product inline */}
      {editing && (
        <div className="card" style={{ padding: 20, marginBottom: 20, border: '1px solid var(--blue)', boxShadow: '0 0 0 3px rgba(51,149,255,0.1)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Edit: {editing.name}</div>
          <ProductForm initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              {['Product', 'SKU', 'EAN', 'Price', 'MRP', 'Stock', 'Category', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>No products match your search</td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</div>
                  {p.weight ? <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{p.weight}g</div> : null}
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: 'var(--blue)' }}>{p.sku}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)' }}>{p.ean || '—'}</td>
                <td style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13 }}>₹{Number(p.price).toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>{p.mrp ? `₹${Number(p.mrp).toLocaleString('en-IN')}` : '—'}</td>
                <td style={{ padding: '10px 14px' }}><StockBadge stock={Number(p.stock)} /></td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>{p.category || '—'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setSharing(p)}
                      style={{ fontSize: 11, padding: '3px 8px', background: '#25D36618', color: '#25D366', border: '1px solid rgba(37,211,102,0.3)', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      Share
                    </button>
                    <button onClick={() => setEditing(p)} style={{ fontSize: 11, padding: '3px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
                    <button onClick={() => setConfirmDelete(p)} style={{ fontSize: 11, padding: '3px 8px', background: 'var(--red-light)', color: 'var(--red)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirm delete */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="animate-in" style={{ width: 380, background: '#fff', borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Delete product?</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              <strong>{confirmDelete.name}</strong> (SKU: {confirmDelete.sku}) will be permanently removed from your catalog. Orders using this product will not be affected.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => handleDelete(confirmDelete.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={refresh} />}
      {showPdfImport && <PdfImportModal onClose={() => setShowPdfImport(false)} onImported={(count) => { toast.success(`${count} products added`); refresh(); setShowPdfImport(false); }} />}
      {sharing && <ShareWhatsAppModal product={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}
