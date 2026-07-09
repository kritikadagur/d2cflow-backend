import { useState, useCallback, useEffect } from 'react';
import { getOrders, saveOrders, addOrder, updateOrder } from '../data/orders';
import { toast } from '../components/Toast';
import { getProducts, decrementStock } from '../data/products';

const BACKEND = import.meta.env.VITE_API_URL || '';
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BACKEND}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

function buildStatusTree(orders) {
  return [
    { key: 'all', label: 'All orders', count: orders.length },
    { key: 'new', label: 'New orders', count: orders.filter(o => o.status === 'new').length, color: '#16A249' },
    { key: 'rtd', label: 'Ready to dispatch', count: orders.filter(o => o.status === 'rtd').length, color: '#7C3AED' },
    { key: 'shipped', label: 'In transit', count: orders.filter(o => o.status === 'shipped').length, color: '#3395FF' },
    { key: 'delivered', label: 'Delivered', count: orders.filter(o => o.status === 'delivered').length, color: '#065F46' },
    { key: 'rto', label: 'RTO', count: orders.filter(o => o.status === 'rto').length, color: '#DC2626' },
    { key: 'cancelled', label: 'Cancelled', count: orders.filter(o => o.status === 'cancelled').length, color: '#687385' },
  ];
}

const CHANNEL_SECTIONS = [
  { key: 'amazon', label: 'Amazon IN' },
  { key: 'flipkart', label: 'Flipkart' },
  { key: 'meesho', label: 'Meesho' },
  { key: 'myntra', label: 'Myntra' },
  { key: 'shopify', label: 'Shopify' },
];

const STATUS_BADGE = {
  new: { label: 'New', cls: 'badge-new' },
  packed: { label: 'Packed', cls: 'badge-packed' },
  rtd: { label: 'RTD', cls: 'badge-rtd' },
  shipped: { label: 'Shipped', cls: 'badge-shipped' },
  delivered: { label: 'Delivered', cls: 'badge-delivered' },
  rto: { label: 'RTO', cls: 'badge-rto' },
  cancelled: { label: 'Cancelled', cls: 'badge-cancelled' },
};

function ProductThumb({ name }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const colors = ['#EBF4FF', '#E6F4EC', '#FEF3C7', '#FCE4EC', '#F3E5F5', '#FFF3E0'];
  const fg = ['#1A6FCC', '#16A249', '#92400E', '#880E4F', '#4A148C', '#E65100'];
  const idx = name.charCodeAt(0) % 6;
  return (
    <div style={{ width: 36, height: 36, borderRadius: 6, background: colors[idx], display: 'flex', alignItems: 'center', justifyContent: 'center', color: fg[idx], fontSize: '11px', fontWeight: 700, flexShrink: 0, border: '1px solid rgba(0,0,0,0.06)' }}>
      {initials}
    </div>
  );
}

function ChannelBadge({ ch }) {
  const map = { amazon: ['AMZ', 'ch-amazon'], flipkart: ['FK', 'ch-flipkart'], meesho: ['MS', 'ch-meesho'], myntra: ['MN', 'ch-myntra'], shopify: ['SHP', 'ch-shopify'] };
  const [label, cls] = map[ch] || ['?', ''];
  return <span className={`channel-badge ${cls}`}>{label}</span>;
}

function AddOrderModal({ onClose, onNavigate }) {
  const catalog = getProducts();
  const [form, setForm] = useState({ customer: '', phone: '', city: '', pincode: '', channel: 'shopify', payment: 'prepaid', qty: 1 });
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const filteredProducts = catalog.filter(p =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase())
  );

  const handleProductSelect = p => {
    setSelectedProduct(p);
    setProductSearch(p.name);
    setShowDropdown(false);
  };

  const handleSave = () => {
    if (!form.customer.trim()) { toast.error('Customer name is required'); return; }
    if (!selectedProduct) { toast.error('Select a product from your catalog'); return; }
    const qty = Number(form.qty);
    if (!qty || qty < 1) { toast.error('Quantity must be at least 1'); return; }
    if (selectedProduct.stock < qty) {
      toast.error(`Only ${selectedProduct.stock} units in stock for "${selectedProduct.name}"`); return;
    }
    decrementStock(selectedProduct.id, qty);
    addOrder({
      customer: form.customer,
      phone: form.phone,
      city: form.city || '—',
      state: '',
      pincode: form.pincode || '—',
      channel: form.channel,
      payment: form.payment,
      items: [{ name: selectedProduct.name, sku: selectedProduct.sku, ean: selectedProduct.ean || '—', qty, price: Number(selectedProduct.price) }],
      total: Number(selectedProduct.price) * qty,
    });
    toast.success(`Order created for ${form.customer} — ${qty}× ${selectedProduct.name}`);
    onClose(true);
  };

  if (catalog.length === 0) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="animate-in" style={{ width: 420, background: '#fff', borderRadius: 'var(--radius-lg)', padding: 32, boxShadow: 'var(--shadow-lg)', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>No products in catalog</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            You need to add products before creating orders. Go to <strong>Products</strong> and add your catalog first.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => { onClose(); if (onNavigate) onNavigate('products'); }}>Go to Products →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => { setShowDropdown(false); }}>
      <div onClick={e => e.stopPropagation()} className="animate-in"
        style={{ width: 520, background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'visible' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Add Manual Order</div>
          <button onClick={onClose} className="btn btn-ghost btn-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Customer */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Customer name *</label>
              <input className="form-input" value={form.customer} onChange={set('customer')} placeholder="Priya Sharma" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Phone</label>
              <input className="form-input" value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>City</label>
              <input className="form-input" value={form.city} onChange={set('city')} placeholder="Mumbai" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Pincode</label>
              <input className="form-input" value={form.pincode} onChange={set('pincode')} placeholder="400001" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Channel</label>
              <select className="form-input form-select" value={form.channel} onChange={set('channel')}>
                <option value="shopify">Shopify</option><option value="amazon">Amazon</option>
                <option value="flipkart">Flipkart</option><option value="meesho">Meesho</option><option value="myntra">Myntra</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Payment</label>
              <select className="form-input form-select" value={form.payment} onChange={set('payment')}>
                <option value="prepaid">Prepaid</option><option value="cod">COD</option>
              </select>
            </div>
          </div>

          {/* Product picker from catalog */}
          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Product * <span style={{ fontWeight: 400, color: 'var(--text-disabled)' }}>(from your catalog)</span>
            </label>
            <input className="form-input" value={productSearch}
              onChange={e => { setProductSearch(e.target.value); setSelectedProduct(null); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Search product name or SKU…" />
            {showDropdown && filteredProducts.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', zIndex: 600, maxHeight: 200, overflow: 'auto', marginTop: 2 }}>
                {filteredProducts.map(p => (
                  <div key={p.id} onClick={() => handleProductSelect(p)}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>SKU: {p.sku} · ₹{Number(p.price).toLocaleString('en-IN')}</div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: p.stock === 0 ? 'var(--red)' : p.stock <= 5 ? '#D97706' : 'var(--green)', flexShrink: 0, marginLeft: 12 }}>
                      {p.stock === 0 ? 'Out of stock' : `${p.stock} left`}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedProduct && (
              <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 12 }}>
                ₹{Number(selectedProduct.price).toLocaleString('en-IN')} · SKU: {selectedProduct.sku} ·
                <span style={{ color: selectedProduct.stock <= 5 ? '#D97706' : 'var(--green)', fontWeight: 600 }}> {selectedProduct.stock} in stock</span>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Qty *</label>
              <input className="form-input" type="number" min={1}
                max={selectedProduct?.stock || 999}
                value={form.qty} onChange={set('qty')} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Unit Price (₹)</label>
              <input className="form-input" type="number" value={selectedProduct ? selectedProduct.price : ''} readOnly
                style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} placeholder="Auto-filled from catalog" />
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Create Order</button>
        </div>
      </div>
    </div>
  );
}

function OrderRow({ order, selected, onSelect, onClick }) {
  const sb = STATUS_BADGE[order.status] || { label: order.status || 'unknown', cls: '' };
  const items = order.items || [];
  const total = Number(order.total ?? order.price ?? 0);

  return (
    <tr onClick={onClick} style={{ cursor: 'pointer' }}>
      <td style={{ padding: '8px 12px', width: 36 }}>
        <input type="checkbox" checked={selected} onChange={onSelect} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer', accentColor: 'var(--blue)' }} />
      </td>
      <td style={{ padding: '8px 4px', width: 20 }}>
        <button className="btn btn-ghost btn-icon" onClick={e => { e.stopPropagation(); toast.info(`Order ${order.id} starred`); }} style={{ padding: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E0" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
      </td>
      <td style={{ padding: '8px 12px', minWidth: 100 }}>
        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--blue)', fontFamily: 'monospace' }}>{(order.id || '').replace('ORD-', '')}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: 2 }}>{order.date}</div>
      </td>
      <td style={{ padding: '8px 12px', minWidth: 140 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ChannelBadge ch={order.channel} />
          <div>
            <div style={{ fontWeight: 500, fontSize: '13px' }}>{order.customer || '—'}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{order.city || '—'}, {order.pincode || '—'}</div>
          </div>
        </div>
      </td>
      <td style={{ padding: '8px 12px', maxWidth: 280 }}>
        {items.length === 0
          ? <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>—</span>
          : items.slice(0, 2).map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: i < items.length - 1 ? 6 : 0 }}>
              <ProductThumb name={item.name || '?'} />
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{item.name || '—'}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>SKU: {item.sku || '—'} · EAN: {item.ean || '—'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{item.qty || 1}× ₹{Number(item.price ?? item.unit_price ?? 0).toLocaleString('en-IN')}</div>
              </div>
            </div>
          ))}
        {items.length > 2 && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: 4 }}>+{items.length - 2} more item(s)</div>}
      </td>
      <td style={{ padding: '8px 12px', width: 80 }}>
        <span className={`badge ${order.payment === 'cod' ? 'badge-cod' : 'badge-prepaid'}`}>{(order.payment || 'prepaid').toUpperCase()}</span>
      </td>
      <td style={{ padding: '8px 12px', width: 100 }}>
        <div style={{ fontWeight: 700, fontSize: '14px' }}>₹{total.toLocaleString('en-IN')}</div>
        <span className={`badge ${sb.cls}`} style={{ marginTop: 3 }}>{sb.label}</span>
      </td>
      <td style={{ padding: '8px 12px', width: 120 }}>
        {order.courier ? (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 500 }}>{order.courier}</div>
            {order.awb && <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{order.awb}</div>}
          </div>
        ) : <span style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>—</span>}
      </td>
    </tr>
  );
}

function OrderDetail({ order: initialOrder, onClose, onOrderUpdated }) {
  const [order, setOrder] = useState(initialOrder);
  const [shipStep, setShipStep] = useState('idle'); // idle | confirm | loading | done | error
  const [shipResult, setShipResult] = useState(null);
  const [shipError, setShipError] = useState('');
  const [weight, setWeight] = useState(0.5);
  const [pickupLocation, setPickupLocation] = useState('Home');
  const [payStep, setPayStep] = useState('idle'); // idle | loading | done | error
  const [payResult, setPayResult] = useState(null);
  const [payError, setPayError] = useState('');

  // Editable shipping address fields — pre-filled from order, user can fix before shipping
  const [shipAddr, setShipAddr] = useState({
    name:    initialOrder.customer || '',
    phone:   String(initialOrder.phone || '').replace(/\D/g, ''),
    address: initialOrder.address || '',
    city:    initialOrder.city !== '—' ? (initialOrder.city || '') : '',
    state:   initialOrder.state !== '—' ? (initialOrder.state || '') : '',
    pincode: initialOrder.pincode !== '—' ? (initialOrder.pincode || '') : '',
  });
  const setAddr = k => e => setShipAddr(a => ({ ...a, [k]: e.target.value }));

  const items = order.items || [];
  const total = Number(order.total ?? order.price ?? 0);

  const handleCreatePaymentLink = async () => {
    if (!total || total <= 0) { toast.error('Order has no amount — cannot create payment link'); return; }
    const phone = String(order.phone || '').replace(/\D/g, '');
    if (!phone || phone.length < 10) { toast.error('Valid customer phone number required'); return; }

    setPayStep('loading');
    setPayError('');
    try {
      // Determine WhatsApp JID for sending the link
      const jid = phone.length === 12 ? `${phone}@s.whatsapp.net`
        : phone.length === 10 ? `91${phone}@s.whatsapp.net`
        : `${phone}@s.whatsapp.net`;

      const data = await apiFetch('/api/payments/create-link', {
        method: 'POST',
        body: JSON.stringify({
          order_id: order.id,
          amount: total,
          customer_name: order.customer || 'Customer',
          customer_phone: phone,
          customer_email: order.email || '',
          description: `Payment for ${items[0]?.name || 'your order'}`,
          send_whatsapp: true,
          whatsapp_jid: jid,
        }),
      });
      setPayResult(data);
      setPayStep('done');
      // Save payment link to order
      updateOrder(order.id, { payment_link: data.short_url, payment_link_id: data.link_id });
      if (data.whatsapp_sent) toast.success('Payment link created & sent via WhatsApp! 🎉');
      else toast.success('Payment link created! Copy and share manually.');
    } catch (e) {
      setPayError(e.message);
      setPayStep('error');
    }
  };

  const handleShip = async () => {
    if (!shipAddr.address.trim()) { toast.error('Address line is required'); return; }
    if (!shipAddr.city.trim())    { toast.error('City is required'); return; }
    if (!shipAddr.state.trim())   { toast.error('State is required'); return; }
    if (!shipAddr.pincode.trim()) { toast.error('Pincode is required'); return; }
    const phone = shipAddr.phone.replace(/\D/g, '') || '9999999999';

    setShipStep('loading');

    // Save address back to order so it persists
    const addrUpdate = updateOrder(order.id, {
      customer: shipAddr.name || order.customer,
      phone: shipAddr.phone,
      address: shipAddr.address,
      city: shipAddr.city,
      state: shipAddr.state,
      pincode: shipAddr.pincode,
    });
    if (addrUpdate) setOrder(addrUpdate);

    try {
      // Unique Shiprocket order ID = internal ID + timestamp suffix to avoid duplicates
      const srOrderId = `${order.id}-${Date.now()}`;

      const payload = {
        order_id: srOrderId,
        order_date: order.date || new Date().toISOString().split('T')[0],
        customer_name: shipAddr.name || order.customer || 'Customer',
        customer_phone: phone,
        customer_email: order.email || '',
        address: shipAddr.address,
        city: shipAddr.city,
        state: shipAddr.state,
        pincode: shipAddr.pincode,
        payment_method: order.payment === 'cod' ? 'COD' : 'Prepaid',
        sub_total: total,
        weight,
        pickup_location: pickupLocation,
        items: items.map(item => ({
          name: item.name || 'Product',
          sku: item.sku || '',
          qty: item.qty || 1,
          price: Number(item.price ?? item.unit_price ?? 0),
        })),
      };

      const data = await apiFetch('/api/shiprocket/shipment/create', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Deduct stock for each item — match by id, sku, or name (case-insensitive)
      const products = getProducts();
      for (const item of items) {
        const nameLower = (item.name || '').toLowerCase().trim();
        const prod = products.find(p =>
          (item.product_id && (p.id === item.product_id || p.sku === item.product_id)) ||
          (item.sku && item.sku !== '—' && p.sku === item.sku) ||
          (nameLower && p.name.toLowerCase().trim() === nameLower) ||
          (nameLower && p.name.toLowerCase().includes(nameLower)) ||
          (nameLower && nameLower.includes(p.name.toLowerCase().trim()))
        );
        if (prod) decrementStock(prod.id, item.qty || 1);
        else console.warn('Stock deduct: no product match for', item.name, item.sku, item.product_id);
      }

      // Update order in localStorage
      const updated = updateOrder(order.id, {
        awb: data.awb,
        courier: data.courier,
        shiprocket_order_id: data.shiprocket_order_id,
        label_url: data.label_url,
        status: 'shipped',
      });
      if (updated) {
        setOrder(updated);
        if (onOrderUpdated) onOrderUpdated(updated);
      }

      setShipResult(data);
      setShipStep('done');
      toast.success(`Shipped! AWB: ${data.awb || 'assigned by courier'}`);
    } catch (e) {
      setShipError(e.message);
      setShipStep('error');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 400, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="animate-in"
        style={{ width: 520, height: '100vh', background: '#fff', boxShadow: 'var(--shadow-lg)', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} className="btn btn-ghost btn-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>Order {order.id}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{order.date} · <ChannelBadge ch={order.channel} /></div>
          </div>
          <span className={`badge ${STATUS_BADGE[order.status]?.cls}`} style={{ marginLeft: 'auto' }}>{STATUS_BADGE[order.status]?.label || order.status}</span>
        </div>

        {/* Customer */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 10 }}>Customer</div>
          <div style={{ fontWeight: 600, fontSize: '14px' }}>{order.customer}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 2 }}>📞 {order.phone || '—'}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 2 }}>📍 {order.city || '—'}{order.state ? `, ${order.state}` : ''}{order.pincode ? ` — ${order.pincode}` : ''}</div>
        </div>

        {/* Items */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 10 }}>Items</div>
          {items.map((item, i) => {
            const unitPrice = Number(item.price ?? item.unit_price ?? 0);
            const lineTotal = unitPrice * (item.qty || 1);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: 10, background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <ProductThumb name={item.name || '?'} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: '13px' }}>{item.name || '—'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: 2 }}>SKU: {item.sku || '—'} · EAN: {item.ean || '—'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700 }}>₹{lineTotal.toLocaleString('en-IN')}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{item.qty || 1} × ₹{unitPrice}</div>
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', borderTop: '1px solid var(--border)', fontWeight: 700, fontSize: '14px' }}>
            <span>Total</span>
            <span style={{ color: 'var(--blue)' }}>₹{total.toLocaleString('en-IN')}</span>
          </div>
        </div>

        {/* Shipping section */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 10 }}>Shipping</div>

          {(order.awb || order.status === 'shipped') ? (
            /* Already shipped */
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>✅ {order.courier || 'Shipped'}</div>
                  {order.awb && <div style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>AWB: {order.awb}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {order.label_url && (
                    <a href={order.label_url} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: '12px' }}>🖨️ Label</a>
                  )}
                  <button className="btn btn-secondary" style={{ fontSize: '12px' }}
                    onClick={() => toast.info(`Track ${order.awb} on ${order.courier}`)}>
                    📍 Track
                  </button>
                </div>
              </div>
            </div>

          ) : shipStep === 'idle' ? (
            /* Ship now CTA */
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
              onClick={() => setShipStep('confirm')}>
              🚀 Ship Now via Shiprocket
            </button>

          ) : shipStep === 'confirm' ? (
            /* Confirm form with address */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Address fields */}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Address</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Customer Name</label>
                  <input value={shipAddr.name} onChange={setAddr('name')} className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Full name" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Phone <span style={{ color: '#dc2626' }}>*</span></label>
                  <input value={shipAddr.phone} onChange={setAddr('phone')} className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="10-digit mobile" />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Address Line <span style={{ color: '#dc2626' }}>*</span></label>
                  <input value={shipAddr.address} onChange={setAddr('address')} className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="House no, street, locality" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>City <span style={{ color: '#dc2626' }}>*</span></label>
                  <input value={shipAddr.city} onChange={setAddr('city')} className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="City" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>State <span style={{ color: '#dc2626' }}>*</span></label>
                  <input value={shipAddr.state} onChange={setAddr('state')} className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="State" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Pincode <span style={{ color: '#dc2626' }}>*</span></label>
                  <input value={shipAddr.pincode} onChange={setAddr('pincode')} className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="6-digit pincode" maxLength={6} />
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />

              {/* Package fields */}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Package</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Weight (kg)</label>
                  <input type="number" min="0.1" step="0.1" value={weight} onChange={e => setWeight(parseFloat(e.target.value) || 0.5)} className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Pickup Location</label>
                  <input type="text" value={pickupLocation} onChange={e => setPickupLocation(e.target.value)} className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Primary" />
                </div>
              </div>

              <div style={{ fontSize: 11, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 7, padding: '7px 10px' }}>
                ℹ️ Best courier auto-assigned. AWB + shipping label generated instantly. Stock reduced on confirm.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShipStep('idle')}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={handleShip}>🚀 Confirm & Create Shipment</button>
              </div>
            </div>

          ) : shipStep === 'loading' ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Creating shipment on Shiprocket…</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>

          ) : shipStep === 'done' ? (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontWeight: 700, color: '#166534', marginBottom: 6 }}>✅ Shipment Created!</div>
              {shipResult?.awb && <div style={{ fontSize: 12, fontFamily: 'monospace' }}>AWB: <strong>{shipResult.awb}</strong></div>}
              {shipResult?.courier && <div style={{ fontSize: 12 }}>Courier: {shipResult.courier}</div>}
              {shipResult?.label_url && (
                <a href={shipResult.label_url} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ marginTop: 8, fontSize: 12 }}>🖨️ Print Label</a>
              )}
            </div>

          ) : shipStep === 'error' ? (
            <div style={{ background: '#fee2e2', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 6 }}>❌ Shipment failed</div>
              <div style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 8 }}>{shipError}</div>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setShipStep('confirm')}>Try Again</button>
            </div>
          ) : null}
        </div>

        {/* Payment Link section — show for all non-cancelled orders */}
        {order.status !== 'cancelled' && <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          {/* If shipped/delivered, only show existing link or nothing */}
          {['shipped', 'delivered'].includes(order.status) && !order.payment_link ? null : <>
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 10 }}>Payment</div>

          {order.payment_link ? (
            /* Already has a payment link */
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#166534', marginBottom: 3 }}>💳 Payment Link Created</div>
                  <a href={order.payment_link} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: '#3b82f6', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {order.payment_link}
                  </a>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(order.payment_link); toast.success('Copied!'); }}
                  style={{ flexShrink: 0, padding: '5px 10px', background: '#fff', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', color: '#166534' }}>
                  📋 Copy
                </button>
              </div>
              <button onClick={handleCreatePaymentLink}
                style={{ marginTop: 8, padding: '4px 10px', background: 'none', border: 'none', fontSize: 11, color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>
                ↻ Create new link
              </button>
            </div>

          ) : payStep === 'idle' ? (
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 13, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
              onClick={handleCreatePaymentLink}>
              💳 Create & Send Payment Link  ₹{total.toLocaleString('en-IN')}
            </button>

          ) : payStep === 'loading' ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Creating Razorpay link…</div>
            </div>

          ) : payStep === 'done' && payResult ? (
            <div style={{ background: 'linear-gradient(135deg,#f0f7ff,#faf5ff)', border: '1px solid #c7d2fe', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontWeight: 700, color: '#4338ca', marginBottom: 6, fontSize: 13 }}>💳 Payment Link Ready!</div>
              <a href={payResult.short_url} target="_blank" rel="noreferrer"
                style={{ display: 'block', fontSize: 12, color: '#3b82f6', wordBreak: 'break-all', marginBottom: 8 }}>
                {payResult.short_url}
              </a>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => { navigator.clipboard.writeText(payResult.short_url); toast.success('Copied!'); }}
                  style={{ padding: '5px 12px', background: '#fff', border: '1px solid #c7d2fe', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', color: '#4338ca', fontWeight: 600 }}>
                  📋 Copy Link
                </button>
                {payResult.whatsapp_sent
                  ? <span style={{ fontSize: 11, color: '#25D366', fontWeight: 600, padding: '5px 0' }}>✅ Sent on WhatsApp</span>
                  : <button onClick={() => toast.info('Manual: copy link and paste in WhatsApp')}
                      style={{ padding: '5px 12px', background: '#25D366', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', color: '#fff', fontWeight: 600 }}>
                      💬 Send on WhatsApp
                    </button>
                }
              </div>
            </div>

          ) : payStep === 'error' ? (
            <div style={{ background: '#fee2e2', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4, fontSize: 12 }}>❌ Failed to create link</div>
              <div style={{ fontSize: 11, color: '#7f1d1d', marginBottom: 8 }}>{payError}</div>
              <button className="btn btn-secondary" style={{ fontSize: 11 }} onClick={() => setPayStep('idle')}>Try Again</button>
            </div>
          ) : null}
          </>}
        </div>}

        {/* Actions */}
        <div style={{ padding: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => toast.success('Label sent to printer')}>🖨️ Print Label</button>
          <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => toast.success(`WhatsApp sent to ${order.phone}`)}>💬 Send WA</button>
          <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => toast.success('Invoice generated')}>🧾 Invoice</button>
          <button className="btn btn-danger" style={{ fontSize: '12px' }} onClick={() => { toast.warn(`Order ${order.id} cancellation requested`); onClose(); }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function OrdersPage({ filterChannel }) {
  const [activeStatus, setActiveStatus] = useState('all');
  const [activeChannel, setActiveChannel] = useState(filterChannel || null);
  const [selected, setSelected] = useState(new Set());
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [page, setPage] = useState(1);
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [orders, setOrders] = useState(() => getOrders());
  const PER_PAGE = 20;

  const refreshOrders = useCallback(() => setOrders(getOrders()), []);

  // Hydrate from backend on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiFetch('/api/orders');
        if (cancelled || !Array.isArray(rows)) return;
        // Normalise backend order rows into the localStorage schema
        const normalised = rows.map(o => {
          const raw = o.raw_payload || {};
          const items = raw.items || [];
          return {
            id: o.channel_order_id || o.id,
            db_id: o.id,
            customer: o.customer_name || raw.customer_name || 'Unknown',
            phone: o.customer_phone || '—',
            city: (o.shipping_address && o.shipping_address.city) || '—',
            state: o.state || '—',
            pincode: o.pincode || '—',
            channel: o.channel || 'manual',
            payment: o.payment_mode || 'prepaid',
            payment_status: o.payment_status || 'pending',
            payment_link: o.payment_link,
            payment_link_id: o.payment_link_id,
            courier: o.courier,
            awb: o.awb,
            items: items.map(it => ({
              name: it.name || 'Product',
              sku: it.sku || it.product_id || '—',
              qty: Number(it.qty) || 1,
              price: Number(it.price ?? it.unit_price ?? 0),
            })),
            total: Number(o.total_amount || raw.total || 0),
            status: o.status || 'new',
            date: new Date(o.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }),
            createdAt: o.created_at,
          };
        });
        // Merge with any local-only orders (channel='manual' created via the UI)
        const local = getOrders();
        const seen = new Set(normalised.map(o => o.id));
        const localOnly = local.filter(o => !seen.has(o.id));
        const merged = [...normalised, ...localOnly];
        saveOrders(merged);
        setOrders(merged);
      } catch (e) {
        console.warn('Orders hydration failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const STATUS_TREE = buildStatusTree(orders);

  const filtered = orders.filter(o => {
    const chMatch = activeChannel ? o.channel === activeChannel : true;
    const stMatch = activeStatus === 'all' ? true : o.status === activeStatus;
    return chMatch && stMatch;
  });

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  const toggleSelect = (id) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const handleBulkAction = (action) => {
    if (selected.size === 0) { toast.warn('Select orders first'); return; }
    if (action === 'print') toast.success(`Printing labels for ${selected.size} orders`);
    if (action === 'email') toast.success(`Confirmation emails sent to ${selected.size} customers`);
    if (action === 'delete') { toast.warn(`${selected.size} orders marked for cancellation`); setSelected(new Set()); }
    if (action === 'ship') toast.success(`Auto-shipping ${selected.size} orders via Shiprocket`);
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left status panel */}
      <div style={{ width: 200, background: '#fff', borderRight: '1px solid var(--border)', flexShrink: 0, overflowY: 'auto', padding: '12px 0' }}>
        <div style={{ padding: '0 12px 8px', fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Status</div>
        {STATUS_TREE.map(s => (
          <button key={s.key} onClick={() => { setActiveStatus(s.key); setActiveChannel(null); setPage(1); }}
            style={{
              display: 'flex', alignItems: 'center', width: '100%', padding: '7px 12px',
              background: activeStatus === s.key && !activeChannel ? 'var(--blue-light)' : 'transparent',
              color: activeStatus === s.key && !activeChannel ? 'var(--blue)' : 'var(--text-primary)',
              boxShadow: activeStatus === s.key && !activeChannel ? 'inset 2px 0 0 var(--blue)' : 'none',
              cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', gap: 8,
              fontWeight: activeStatus === s.key && !activeChannel ? 500 : 400,
            }}>
            {s.color && <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />}
            <span style={{ flex: 1, textAlign: 'left' }}>{s.label}</span>
            <span style={{ fontSize: '11px', color: activeStatus === s.key && !activeChannel ? 'var(--blue)' : 'var(--text-secondary)', fontWeight: 600 }}>{s.count}</span>
          </button>
        ))}

        {!filterChannel && (
          <>
            <div style={{ padding: '12px 12px 6px', fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: 4, borderTop: '1px solid var(--border)' }}>By Channel</div>
            {CHANNEL_SECTIONS.map(ch => {
              const isActive = activeChannel === ch.key;
              return (
                <button key={ch.key} onClick={() => { setActiveChannel(isActive ? null : ch.key); setActiveStatus('all'); setPage(1); }}
                  style={{
                    display: 'flex', alignItems: 'center', width: '100%', padding: '6px 12px',
                    background: isActive ? 'var(--blue-light)' : 'transparent',
                    boxShadow: isActive ? 'inset 2px 0 0 var(--blue)' : 'none',
                    cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', gap: 8,
                    color: isActive ? 'var(--blue)' : 'var(--text-secondary)',
                    fontWeight: isActive ? 500 : 400,
                  }}>
                  <span style={{ flex: 1, textAlign: 'left', textTransform: 'capitalize' }}>{ch.label}</span>
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>{orders.filter(o => o.channel === ch.key).length}</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ padding: '12px 16px', background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-primary" style={{ gap: 6 }} onClick={() => setShowAddOrder(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add order
          </button>

          <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />

          {[
            { icon: 'M17 17H17.01 M17 3H5a2 2 0 00-2 2v4a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2z M3 11v6a2 2 0 002 2h12a2 2 0 002-2v-6', tip: 'Print labels', action: () => handleBulkAction('print') },
            { icon: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6', tip: 'Send email', action: () => handleBulkAction('email') },
            { icon: 'M3 6h18 M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2', tip: 'Delete', action: () => handleBulkAction('delete') },
          ].map((item, i) => (
            <button key={i} onClick={item.action}
              style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', padding: '5px 10px', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={item.icon}/></svg>
              {item.tip}
            </button>
          ))}

          {selected.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--blue-light)', borderRadius: 'var(--radius)', border: '1px solid rgba(51,149,255,0.2)' }}>
              <span style={{ fontSize: '12px', color: 'var(--blue)', fontWeight: 500 }}>{selected.size} selected</span>
              <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: '11px' }} onClick={() => handleBulkAction('ship')}>Bulk ship</button>
              <button onClick={() => setSelected(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: '12px' }}>✕</button>
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-secondary" style={{ gap: 6, fontSize: '12px' }} onClick={() => { setShowFilter(v => !v); toast.info('Filter panel — connect backend for live filters'); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              {activeChannel ? `Channel: ${activeChannel}` : activeStatus !== 'all' ? `Status: ${activeStatus}` : 'Order filtering'}
            </button>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {Math.min((page-1)*PER_PAGE+1, filtered.length)}–{Math.min(page*PER_PAGE, filtered.length)} of {filtered.length} orders
            </span>
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="btn btn-ghost btn-icon" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
                style={{ border: '1px solid var(--border)', padding: '5px 8px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <button className="btn btn-ghost btn-icon" onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages}
                style={{ border: '1px solid var(--border)', padding: '5px 8px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
          {orders.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>📋</div>
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)', marginBottom: 8 }}>No orders yet</div>
              <div style={{ fontSize: 13, maxWidth: 340, lineHeight: 1.6, marginBottom: 20 }}>
                Create orders manually using the <strong>Add order</strong> button above, or connect a sales channel in <strong>Integrations</strong> to sync orders automatically.
              </div>
              <button className="btn btn-primary" onClick={() => setShowAddOrder(true)}>
                + Add your first order
              </button>
            </div>
          ) : (
            <table className="table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}><input type="checkbox" style={{ accentColor: 'var(--blue)' }} onChange={e => setSelected(e.target.checked ? new Set(paginated.map(o => o.id)) : new Set())} /></th>
                  <th style={{ width: 20 }}></th>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Payment</th>
                  <th>Total / Status</th>
                  <th>Shipping</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(order => (
                  <OrderRow key={order.id} order={order}
                    selected={selected.has(order.id)}
                    onSelect={() => toggleSelect(order.id)}
                    onClick={() => setSelectedOrder(order)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedOrder && (
        <OrderDetail
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onOrderUpdated={updated => {
            refreshOrders();
            setSelectedOrder(updated);
          }}
        />
      )}
      {showAddOrder && <AddOrderModal onClose={(didCreate) => { setShowAddOrder(false); if (didCreate) refreshOrders(); }} onNavigate={undefined} />}
    </div>
  );
}
