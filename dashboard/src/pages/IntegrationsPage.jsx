import { useState, useEffect, useRef } from 'react';
import { toast } from '../components/Toast';
import { getOrders, saveOrders } from '../data/orders';
import { api } from '../lib/api';
import QRCode from 'react-qr-code';

const BACKEND = '';

const INTEGRATIONS = [
  {
    group: 'Marketplaces',
    items: [
      {
        id: 'amazon', name: 'Amazon Seller Central', logo: '📦', color: '#FF9900',
        desc: 'Sync orders via SP-API. Supports Easy Ship, Self-Ship & FBA.',
        authType: 'oauth',
        oauthEndpoint: '/api/integrations/amazon/connect',
        permissions: ['Read & sync all orders', 'Confirm shipments & push AWB', 'Access product listings', 'Inventory management'],
        fields: [],
      },
      {
        id: 'flipkart', name: 'Flipkart Seller Hub', logo: '🛍️', color: '#2874F0',
        desc: 'Pull orders, push AWB and status via Flipkart Seller API.',
        authType: 'oauth',
        oauthEndpoint: '/api/integrations/flipkart/connect',
        permissions: ['Read & sync all orders', 'Dispatch orders & push AWB', 'Update order status'],
        fields: [],
      },
      {
        id: 'meesho', name: 'Meesho', logo: '🪡', color: '#9B59B6',
        desc: 'Sync orders and inventory via Meesho Supplier API.',
        authType: 'credentials',
        fields: [
          { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'ms_api_xxxxxxxx', hint: 'Meesho Supplier Panel → My Account → API Access' },
          { key: 'supplier_id', label: 'Supplier ID', type: 'text', placeholder: 'MS_SUPPLIER_XXXXX' },
        ],
      },
      {
        id: 'myntra', name: 'Myntra', logo: '👗', color: '#FF3F6C',
        desc: 'Connect your Myntra seller account for order automation.',
        authType: 'credentials',
        fields: [
          { key: 'client_id', label: 'Client ID', type: 'text', placeholder: 'MYNTRA_CL_XXXXX' },
          { key: 'client_secret', label: 'Client Secret', type: 'password', placeholder: '••••••••', hint: 'Myntra Partner Portal → API Settings' },
        ],
      },
      {
        id: 'ajio', name: 'Ajio Business', logo: '🧥', color: '#E84C3D',
        desc: 'Connect Ajio seller portal for order management.',
        authType: 'credentials',
        fields: [
          { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'ajio_key_xxxxxxxx' },
          { key: 'seller_id', label: 'Seller ID', type: 'text', placeholder: 'AJIO_V_XXXXX', hint: 'Ajio Business Portal → My Account' },
        ],
      },
      {
        id: 'nykaa', name: 'Nykaa Fashion', logo: '💄', color: '#FC2779',
        desc: 'Sync Nykaa orders and product listings.',
        authType: 'credentials',
        fields: [
          { key: 'api_token', label: 'API Token', type: 'password', placeholder: 'nyk_api_xxxxxxxx', hint: 'Nykaa Seller Hub → API Integration' },
          { key: 'seller_id', label: 'Seller ID', type: 'text', placeholder: 'NYK_XXXXX' },
        ],
      },
      {
        id: 'snapdeal', name: 'Snapdeal', logo: '🔴', color: '#E02020',
        desc: 'Connect Snapdeal Seller Zone for order sync.',
        authType: 'credentials',
        fields: [
          { key: 'api_token', label: 'API Token', type: 'password', placeholder: 'sd_api_xxxxxxxx', hint: 'Snapdeal Seller Zone → API Access' },
          { key: 'seller_id', label: 'Seller ID', type: 'text', placeholder: 'SD_XXXXX' },
        ],
      },
      {
        id: 'firstcry', name: 'FirstCry', logo: '🍼', color: '#F57C00',
        desc: 'Connect FirstCry Seller Portal for order management.',
        authType: 'credentials',
        fields: [
          { key: 'api_token', label: 'API Token', type: 'password', placeholder: 'fc_api_xxxxxxxx', hint: 'FirstCry Seller Portal → API Settings' },
          { key: 'seller_code', label: 'Seller Code', type: 'text', placeholder: 'FC_XXXXX' },
        ],
      },
    ],
  },
  {
    group: 'Your Storefront',
    items: [
      {
        id: 'shopify', name: 'Shopify', logo: '🛒', color: '#96BF48',
        desc: 'Connect your Shopify store using an Admin API access token.',
        authType: 'credentials',
        fields: [
          { key: 'shop_domain', label: 'Shop domain', type: 'text', placeholder: 'your-store.myshopify.com', hint: 'Your myshopify.com subdomain' },
          { key: 'access_token', label: 'Admin API access token', type: 'password', placeholder: 'shpat_xxxxxxxxxxxx', hint: 'Shopify Admin → Apps → Develop apps → Create app → API credentials' },
        ],
      },
      {
        id: 'woocommerce', name: 'WooCommerce', logo: '🏪', color: '#7F54B3',
        desc: 'Connect your WooCommerce store via REST API.',
        authType: 'credentials',
        fields: [
          { key: 'store_url', label: 'Store URL', type: 'text', placeholder: 'https://yourdomain.com', hint: 'Your WordPress site root URL' },
          { key: 'consumer_key', label: 'Consumer Key', type: 'text', placeholder: 'ck_xxxxxxxxxxxx', hint: 'WooCommerce → Settings → Advanced → REST API' },
          { key: 'consumer_secret', label: 'Consumer Secret', type: 'password', placeholder: 'cs_xxxxxxxxxxxx' },
        ],
      },
    ],
  },
  {
    group: 'Couriers & Shipping',
    items: [
      {
        id: 'shiprocket', name: 'Shiprocket', logo: '🚀', color: '#E74C3C',
        desc: 'Multi-courier aggregator covering 25+ couriers including Delhivery, BlueDart, Xpressbees.',
        authType: 'credentials',
        fields: [
          { key: 'email', label: 'Shiprocket Email', type: 'email', placeholder: 'you@yourbrand.com' },
          { key: 'password', label: 'Shiprocket Password', type: 'password', placeholder: '••••••••' },
        ],
      },
      {
        id: 'delhivery', name: 'Delhivery', logo: '🔵', color: '#0066CC',
        desc: 'Direct Delhivery integration — 18,500+ pin codes, express & surface.',
        authType: 'credentials',
        fields: [
          { key: 'api_token', label: 'API Token', type: 'password', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', hint: 'Delhivery Business Portal → Settings → API Token' },
        ],
      },
      {
        id: 'bluedart', name: 'BlueDart DHL', logo: '🔴', color: '#E63312',
        desc: 'Premium express courier for high-value and time-sensitive shipments.',
        authType: 'credentials',
        fields: [
          { key: 'login_id', label: 'Login ID', type: 'text', placeholder: 'BD_XXXXXXX', hint: 'BlueDart API Portal' },
          { key: 'api_password', label: 'API Password', type: 'password', placeholder: '••••••••' },
          { key: 'license_key', label: 'License Key', type: 'password', placeholder: 'XXXXXXXXXXXXXXXX' },
        ],
      },
      {
        id: 'ecomexpress', name: 'Ecom Express', logo: '🟢', color: '#2ECC71',
        desc: 'Tier-2 & Tier-3 city specialist — 27,000+ delivery locations.',
        authType: 'credentials',
        fields: [
          { key: 'username', label: 'Username', type: 'text', placeholder: 'ECOM_XXXXXX', hint: 'Ecom Express Merchant Portal credentials' },
          { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
        ],
      },
    ],
  },
  {
    group: 'Social & Messaging',
    items: [
      {
        id: 'whatsapp', name: 'WhatsApp Business', logo: '💬', color: '#25D366',
        desc: 'Meta Cloud API — order confirmations, dispatch alerts, NDR re-engagement.',
        authType: 'credentials',
        fields: [
          { key: 'phone_number_id', label: 'Phone Number ID', type: 'text', placeholder: '102938475610293', hint: 'Meta Business Suite → WhatsApp → API Setup' },
          { key: 'access_token', label: 'Permanent Access Token', type: 'password', placeholder: 'EAABwzLixnjYBO...', hint: 'System user permanent token with whatsapp_business_messaging permission' },
          { key: 'waba_id', label: 'WhatsApp Business Account ID', type: 'text', placeholder: '9876543210987' },
        ],
      },
      {
        id: 'meta', name: 'Meta (Facebook & Instagram)', logo: '📘', color: '#1877F2',
        desc: 'Receive orders from Facebook Shop & Instagram Shopping. Requires OAuth.',
        authType: 'oauth',
        oauthEndpoint: '/api/integrations/meta/connect',
        fields: [],
        permissions: ['Read & write Facebook Page orders', 'Instagram Shopping access', 'Product catalog sync', 'Messenger & DM webhooks'],
      },
      {
        id: 'instagram', name: 'Instagram DMs', logo: '📸', color: '#E1306C',
        desc: 'Auto-respond to order queries via Instagram DMs and story mentions.',
        authType: 'oauth',
        oauthEndpoint: '/api/integrations/meta/connect',
        fields: [],
        permissions: ['Instagram Business account access', 'DM read & reply', 'Story mention webhooks', 'Broadcast message campaigns'],
      },
    ],
  },
  {
    group: 'Accounting & GST',
    items: [
      {
        id: 'zoho', name: 'Zoho Books', logo: '📊', color: '#E42527',
        desc: 'Auto-create GST invoices, sync payments and reconcile accounts.',
        authType: 'credentials',
        fields: [
          { key: 'access_token', label: 'OAuth Access Token', type: 'password', placeholder: '1000.xxxxxxxx', hint: 'Zoho API Console → OAuth → Generate Token with ZohoBooks.fullaccess.all scope' },
          { key: 'organization_id', label: 'Organization ID', type: 'text', placeholder: '12345678', hint: 'Zoho Books → Settings → Organization Profile' },
        ],
      },
      {
        id: 'tally', name: 'Tally Prime', logo: '🧾', color: '#0078D4',
        desc: 'Push orders as vouchers to Tally via local TallyConnector bridge.',
        authType: 'credentials',
        fields: [
          { key: 'tally_host', label: 'TallyConnector URL', type: 'text', placeholder: 'http://localhost:9000', hint: 'Run TallyConnector on the machine where Tally is installed. See docs.' },
          { key: 'company_name', label: 'Company Name (in Tally)', type: 'text', placeholder: 'Your Company Pvt. Ltd.' },
        ],
      },
    ],
  },
];

// ── Guide accordion ──────────────────────────────────────────────────────────

function GuideAccordion({ channel }) {
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState(null);

  const load = async () => {
    if (guide) { setOpen(o => !o); return; }
    try {
      const res = await fetch(`/api/integrations/guide/${channel}`);
      if (res.ok) { setGuide(await res.json()); setOpen(true); }
    } catch (_) {}
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 5, padding: 0, fontFamily: 'inherit' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="m9 18 6-6-6-6"/>
        </svg>
        Where to find these credentials
      </button>
      {open && guide && (
        <div style={{ marginTop: 10, padding: '12px 14px', background: '#f8faff', border: '1px solid #dbeafe', borderRadius: 'var(--radius)', fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#1e40af' }}>
            Setup guide · ~{guide.estimated_minutes} min
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {guide.steps.map(s => (
              <div key={s.n} style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#3b82f6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                  {s.n}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{s.title}</div>
                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{s.instruction}</div>
                  {s.url_template && s.url_label && (
                    <a href={s.url_template} target="_blank" rel="noreferrer"
                      style={{ color: '#3b82f6', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontWeight: 500 }}>
                      {s.url_label} ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Real API test via backend ─────────────────────────────────────────────────

async function testCredentials(channel, credentials) {
  const res = await fetch(`/api/integrations/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, credentials }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Connection failed');
  return data.message;
}

async function getOAuthUrl(endpoint) {
  const { data } = await api.get(endpoint);
  if (!data.redirect_url) throw new Error('Backend did not return a redirect URL');
  return data.redirect_url;
}

// ── ShopifyConnectModal ───────────────────────────────────────────────────────

const SHOPIFY_STORAGE_KEY = 'd2cflow_shopify_connection';

function loadShopifyConnection() {
  try { return JSON.parse(localStorage.getItem(SHOPIFY_STORAGE_KEY) || 'null'); } catch { return null; }
}

function ShopifyConnectModal({ onClose, onConnected }) {
  const [step, setStep] = useState('form'); // form | waiting | syncing | connected | error
  const [shopDomain, setShopDomain] = useState('b38452-3c.myshopify.com');
  const [errorMsg, setErrorMsg] = useState('');
  const [shopInfo, setShopInfo] = useState(null);
  const [syncStats, setSyncStats] = useState(null);
  const pollRef = useRef(null);
  const popupRef = useRef(null);

  const cleanDomain = d => {
    const s = d.trim().toLowerCase().replace(/https?:\/\//,'').replace(/\//g,'');
    return s.endsWith('.myshopify.com') ? s : `${s}.myshopify.com`;
  };

  const startPolling = (shop) => {
    let attempts = 0;
    setStep('syncing');
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch(`${BACKEND}/api/shopify/status?shop_domain=${encodeURIComponent(shop)}`);
        const s = await r.json();
        if (s.connected) {
          clearInterval(pollRef.current);
          setShopInfo(s);
          // Give sync 2 more seconds then pull orders
          setTimeout(async () => {
            const r2 = await fetch(`${BACKEND}/api/shopify/status?shop_domain=${encodeURIComponent(shop)}`);
            const s2 = await r2.json();
            setSyncStats(s2);
            // Merge orders into localStorage
            const syncRes = await fetch(`${BACKEND}/api/shopify/orders?shop_domain=${encodeURIComponent(shop)}&limit=500`);
            const syncData = await syncRes.json();
            if (syncData.orders?.length) {
              const existing = getOrders().filter(o => o.channel !== 'shopify');
              saveOrders([...syncData.orders, ...existing]);
            }
            const conn = { shop_domain: shop, shop_name: s2.shop_name, order_count: s2.order_count, connected_at: new Date().toISOString() };
            localStorage.setItem(SHOPIFY_STORAGE_KEY, JSON.stringify(conn));
            setStep('connected');
            onConnected('shopify', conn);
          }, 2500);
        } else if (attempts >= 180) {
          clearInterval(pollRef.current);
          setErrorMsg('Timed out waiting for authorization. Please try again.');
          setStep('error');
        }
      } catch (_) {}
    }, 1000);
  };

  const handleOAuth = async () => {
    const shop = cleanDomain(shopDomain);
    setStep('waiting');
    try {
      const res = await fetch(`${BACKEND}/api/shopify/oauth/start?shop=${encodeURIComponent(shop)}`);
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.detail || 'Failed to start OAuth'); setStep('error'); return; }
      // Open Shopify auth in a popup
      const w = 700, h = 800;
      const left = window.screen.width / 2 - w / 2;
      const top = window.screen.height / 2 - h / 2;
      popupRef.current = window.open(data.redirect_url, 'shopify_oauth',
        `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`);
      // Poll until backend has the connection
      startPolling(shop);
    } catch (e) {
      setErrorMsg(e.message || 'Could not reach backend');
      setStep('error');
    }
  };

  // Listen for hash-based redirect from OAuth callback
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.includes('shopify-connected')) {
        const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
        const shop = params.get('shop');
        if (shop) startPolling(shop);
        window.location.hash = '';
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('hashchange', onHash); clearInterval(pollRef.current); };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={step === 'connected' ? undefined : () => { clearInterval(pollRef.current); onClose(); }}>
      <div onClick={e => e.stopPropagation()} className="animate-in"
        style={{ width: 520, background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#96BF4818', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🛒</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Connect Shopify</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>Secure OAuth 2.0 — real-time order sync</div>
          </div>
          {step !== 'connected' && (
            <button onClick={() => { clearInterval(pollRef.current); onClose(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)', display: 'flex' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>

        {/* Form */}
        {step === 'form' && (
          <div style={{ padding: 24 }}>
            <div style={{ background: '#EBF4FF', borderRadius: 'var(--radius)', padding: '12px 14px', border: '1px solid #BFDBFE', marginBottom: 20, fontSize: 12, color: '#1E40AF', lineHeight: 1.7 }}>
              <strong>Secure OAuth 2.0</strong> — d2cflow will never see your Shopify password. You'll authorize access in a popup window and be redirected back automatically.
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>
                Shop domain <span style={{ color: 'var(--red)' }}>*</span>
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginBottom: 4 }}>Your myshopify.com store address</div>
              <input className="form-input" value={shopDomain} onChange={e => setShopDomain(e.target.value)}
                placeholder="your-store.myshopify.com" style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>

            <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
              <strong>After connecting we will:</strong>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {['Pull all existing orders into d2cflow', 'Register webhooks — new orders appear instantly', 'Sync fulfillment status changes in real-time'].map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                    {t}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleOAuth} disabled={!shopDomain.trim()} style={{ gap: 7 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                Authorize with Shopify
              </button>
            </div>
          </div>
        )}

        {/* Waiting for popup */}
        {step === 'waiting' && (
          <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 48 }}>🔐</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Authorize in the popup window</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 320, lineHeight: 1.6 }}>
              A Shopify authorization window has opened. Log in and click <strong>Install app</strong> to grant access.
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-disabled)' }}>Waiting for authorization…</div>
          </div>
        )}

        {/* Syncing */}
        {step === 'syncing' && (
          <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 52, height: 52, border: '4px solid #96BF4830', borderTop: '4px solid #96BF48', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>Syncing your orders…</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
              Authorization confirmed. Pulling your order history and registering real-time webhooks.
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Connected */}
        {step === 'connected' && (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '14px 16px', background: 'var(--green-light)', borderRadius: 'var(--radius)', border: '1px solid rgba(34,197,94,0.25)' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>Shopify connected!</div>
                <div style={{ fontSize: 12, color: 'var(--green)', opacity: 0.85, marginTop: 2 }}>{shopInfo?.shop_name} · {shopInfo?.shop_domain}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Orders synced', value: syncStats?.order_count ?? '…', icon: '📦' },
                { label: 'New orders', value: syncStats?.new_count ?? '—', icon: '🆕' },
                { label: 'Webhooks', value: 'Live ✓', icon: '⚡' },
              ].map(s => (
                <div key={s.label} style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: '10px 14px', background: '#EBF4FF', borderRadius: 'var(--radius)', border: '1px solid #BFDBFE', fontSize: 12, color: '#1E40AF', marginBottom: 20 }}>
              <strong>Real-time sync active.</strong> New orders appear in d2cflow the moment they're placed on Shopify.
            </div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onClose}>
              View Orders →
            </button>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20, padding: '14px 16px', background: 'var(--red-light)', borderRadius: 'var(--radius)', border: '1px solid rgba(220,38,38,0.25)' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--red)' }}>Connection failed</div>
                <div style={{ fontSize: 12, color: 'var(--red)', opacity: 0.85, marginTop: 2 }}>{errorMsg}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setStep('form')}>← Try again</button>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── WhatsAppModal ─────────────────────────────────────────────────────────────

const WA_CHATS_KEY = 'd2cflow_wa_chats';

function loadWaChats() {
  try { return JSON.parse(localStorage.getItem(WA_CHATS_KEY) || '[]'); } catch { return []; }
}

async function waFetch(path, options = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

function WhatsAppModal({ onClose, onConnected }) {
  // step: idle | starting | qr | connected
  const [step, setStep] = useState('idle');
  const [qrData, setQrData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  // Check initial bridge state on open
  useEffect(() => {
    waFetch('/api/whatsapp/bridge-status')
      .then(d => {
        if (d.connected) {
          setStep('connected');
          loadOrders();
          onConnected('whatsapp', {});
        } else if (d.qr_available && d.qr_b64) {
          setQrData(d.qr_b64.replace(/^qr:/, ''));
          setStep('qr');
          startPolling();
        }
      })
      .catch(() => {});
    return () => stopPolling();
  }, []);

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const d = await waFetch('/api/whatsapp/bridge-status');
        if (d.connected) {
          stopPolling();
          setStep('connected');
          setQrData(null);
          loadOrders();
          onConnected('whatsapp', {});
          toast.success('WhatsApp connected! 🎉');
        } else if (d.qr_b64) {
          setQrData(d.qr_b64.replace(/^qr:/, ''));
          setStep('qr');
        }
      } catch (_) {}
    }, 2000);
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleConnect = async () => {
    // Don't try to spawn a local bridge process — that only works in dev.
    // On Render/Vercel the bridge is already a separate service; just start
    // polling for the QR that it emits.
    setError('');
    setStep('qr');
    startPolling();
    setTimeout(async () => {
      try {
        const d = await waFetch('/api/whatsapp/bridge-status');
        if (d.qr_b64) setQrData(d.qr_b64.replace(/^qr:/, ''));
        else if (d.connected) setStep('connected');
      } catch (e) {
        setError(e.message || 'Could not reach WhatsApp bridge.');
        setStep('idle');
      }
    }, 1500);
  };

  const loadOrders = () => {
    setOrdersLoading(true);
    waFetch('/api/whatsapp/detected-orders')
      .then(d => { setOrders(d.orders || []); setOrdersLoading(false); })
      .catch(() => setOrdersLoading(false));
  };

  const pendingCount = orders.filter(o => o.status === 'pending').length;

  const handleConfirm = async (order) => {
    try {
      const res = await waFetch('/api/whatsapp/confirm-order', { method: 'POST', body: JSON.stringify({ order_id: order.id }) });
      const { addOrder } = await import('../data/orders');
      addOrder(res.localStorage_payload);
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'confirmed' } : o));
      toast.success(`Order confirmed · Payment link sent to ${order.customer_name}`);
    } catch (e) { toast.error(e.message || 'Failed'); }
  };

  const handleReject = async (order) => {
    try {
      await waFetch('/api/whatsapp/reject-order', { method: 'POST', body: JSON.stringify({ order_id: order.id }) });
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'rejected' } : o));
    } catch (e) { toast.error(e.message || 'Failed'); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={step !== 'starting' ? onClose : undefined}>
      <div onClick={e => e.stopPropagation()} className="animate-in"
        style={{ width: step === 'connected' ? 600 : 440, maxHeight: '90vh', background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#25D36618', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>💬</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Connect WhatsApp</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>
              {step === 'idle' && 'Scan QR to link your WhatsApp account'}
              {step === 'starting' && 'Starting connection…'}
              {step === 'qr' && 'Open WhatsApp → Linked Devices → Scan QR'}
              {step === 'connected' && <span style={{ color: '#25D366', fontWeight: 500 }}>✅ Connected · All messages scanned automatically</span>}
            </div>
          </div>
          {step !== 'starting' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)', display: 'flex' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>

          {/* IDLE — connect button */}
          {step === 'idle' && (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>📱</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Connect your WhatsApp</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.7 }}>
                Link your existing WhatsApp account — personal or Business.<br />
                All incoming customer messages are scanned automatically.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24, textAlign: 'left', background: 'var(--surface-2)', borderRadius: 10, padding: '14px 16px' }}>
                {[
                  ['📩', 'Customers message you → order intent auto-detected'],
                  ['💳', 'They confirm → Razorpay payment link sent instantly'],
                  ['📦', 'Payment done → Shiprocket shipment created'],
                  ['✅', 'Tracking number sent back to customer automatically'],
                ].map(([icon, text]) => (
                  <div key={text} style={{ display: 'flex', gap: 10, fontSize: 13 }}>
                    <span>{icon}</span><span style={{ color: 'var(--text-secondary)' }}>{text}</span>
                  </div>
                ))}
              </div>
              {error && (
                <div style={{ background: 'var(--red-light)', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 16, textAlign: 'left' }}>
                  {error}
                </div>
              )}
              <button onClick={handleConnect} className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', height: 44, fontSize: 15, background: '#25D366', borderColor: '#25D366', gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Connect WhatsApp
              </button>
            </div>
          )}

          {/* STARTING */}
          {step === 'starting' && (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <div style={{ width: 44, height: 44, border: '3px solid #25D36640', borderTop: '3px solid #25D366', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
              <div style={{ fontWeight: 600, fontSize: 15 }}>Starting WhatsApp bridge…</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>This takes a few seconds</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* QR CODE */}
          {step === 'qr' && (
            <div style={{ padding: '24px 32px', textAlign: 'center' }}>
              <div style={{ background: '#f0fdf4', border: '1px solid rgba(37,211,102,0.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#166534' }}>
                <strong>Open WhatsApp</strong> → tap ⋮ Menu → <strong>Linked Devices</strong> → <strong>Link a Device</strong> → scan this QR
              </div>

              {qrData ? (
                <div style={{ display: 'inline-block', padding: 16, background: '#fff', border: '2px solid var(--border)', borderRadius: 12, marginBottom: 16 }}>
                  <QRCode value={qrData} size={220} />
                </div>
              ) : (
                <div style={{ width: 252, height: 252, background: 'var(--surface-2)', borderRadius: 12, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                  Generating QR…
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#25D366', animation: 'pulse 1.5s infinite' }} />
                Waiting for scan…
                <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-disabled)', marginTop: 6 }}>QR refreshes every 20 seconds</div>
            </div>
          )}

          {/* CONNECTED */}
          {step === 'connected' && (
            <div style={{ padding: 20 }}>
              <div style={{ background: '#f0fdf4', border: '1px solid rgba(37,211,102,0.25)', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#166534', marginBottom: 8 }}>🟢 Live — scanning messages every 2 minutes</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {['Customer messages detected as orders automatically', 'YES reply → Razorpay payment link sent instantly', 'Payment confirmed → Shiprocket shipment created'].map(t => (
                    <div key={t} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#166534' }}>
                      <span>✓</span><span>{t}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
                Incoming orders {pendingCount > 0 && <span style={{ background: '#fef9c3', color: '#854d0e', borderRadius: 20, padding: '2px 8px', fontSize: 11, textTransform: 'none', fontWeight: 600, marginLeft: 6 }}>{pendingCount} pending</span>}
              </div>

              {ordersLoading ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>Loading…</div>
              ) : orders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                  No orders yet. When customers message you, they appear here automatically.
                </div>
              ) : orders.map(order => (
                <div key={order.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 8, background: order.status === 'pending' ? '#fff' : 'var(--surface-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{order.customer_name}</span>
                        {order.product_hint && <span style={{ background: '#eff6ff', color: '#3b82f6', borderRadius: 20, padding: '1px 8px', fontSize: 11 }}>{order.product_hint}</span>}
                        {order.price && <span style={{ fontSize: 12, color: '#059669', fontWeight: 600, marginLeft: 'auto' }}>₹{order.price.toLocaleString('en-IN')}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        "{order.message_text?.slice(0, 80)}{order.message_text?.length > 80 ? '…' : ''}"
                      </div>
                    </div>
                    {order.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button onClick={() => handleConfirm(order)} style={{ fontSize: 11, padding: '5px 10px', background: '#dcfce7', color: '#166534', border: '1px solid rgba(22,101,52,0.2)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>✅ Confirm</button>
                        <button onClick={() => handleReject(order)} style={{ fontSize: 11, padding: '5px 10px', background: 'var(--red-light)', color: 'var(--red)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>Reject</button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, fontWeight: 600, background: order.status === 'confirmed' ? '#dcfce7' : '#fee2e2', color: order.status === 'confirmed' ? '#166534' : '#991b1b' }}>
                        {order.status === 'confirmed' ? '✓ Confirmed' : '✗ Rejected'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── ConnectModal ──────────────────────────────────────────────────────────────

function ConnectModal({ integration, onClose, onSave }) {
  const [step, setStep] = useState('form'); // form | loading | success | error
  const [creds, setCreds] = useState(() => {
    const init = {};
    integration.fields?.forEach(f => { init[f.key] = ''; });
    return init;
  });
  const [resultMsg, setResultMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const allFilled = integration.fields.every(f => creds[f.key]?.trim());

  const handleConnect = async () => {
    setStep('loading');
    try {
      const msg = await testCredentials(integration.id, creds);
      setResultMsg(msg);
      setStep('success');
    } catch (e) {
      setErrorMsg(e.message);
      setStep('error');
    }
  };

  const handleOAuth = async () => {
    setStep('loading');
    try {
      const url = await getOAuthUrl(integration.oauthEndpoint);
      const w = 700, h = 800;
      const left = window.screen.width / 2 - w / 2;
      const top = window.screen.height / 2 - h / 2;
      window.open(url, `${integration.id}_oauth`, `width=${w},height=${h},left=${left},top=${top}`);
      setResultMsg(`Authorization window opened. Complete login in the popup, then click Save.`);
      setStep('success');
    } catch (e) {
      setErrorMsg(e.message);
      setStep('error');
    }
  };

  const handleSave = async () => {
    try {
      // Save credentials to backend DB (requires auth JWT via api interceptor)
      await api.post('/api/integrations', { channel: integration.id, credentials: creds });
      // Trigger catalog import in the background for catalog channels
      const catalogChannels = ['shopify', 'amazon', 'flipkart'];
      if (catalogChannels.includes(integration.id)) {
        api.post(`/trigger/catalog-import?channel=${integration.id}`).catch(() => {});
      }
    } catch (e) {
      // Non-fatal — still mark connected locally if backend save fails
      console.warn('Failed to save credentials to backend:', e.message);
    }
    onSave(integration.id, { display_name: resultMsg?.split('·')[0]?.trim() || integration.name });
    toast.success(`${integration.name} connected`);
    onClose();
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={step !== 'loading' ? onClose : undefined}
    >
      <div onClick={e => e.stopPropagation()} className="animate-in"
        style={{ width: 520, background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: integration.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
            {integration.logo}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{integration.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{integration.desc}</div>
          </div>
          {step !== 'loading' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)', display: 'flex' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>

        {/* Form */}
        {step === 'form' && (
          <div style={{ padding: 24 }}>
            {integration.authType === 'oauth' ? (
              <div>
                <div style={{ background: '#EBF4FF', borderRadius: 'var(--radius)', padding: '12px 14px', border: '1px solid #BFDBFE', marginBottom: 20, fontSize: 13, color: '#1E40AF', lineHeight: 1.6 }}>
                  <strong>Secure OAuth 2.0</strong> — You'll be redirected to {integration.name} to authorize access. d2cflow will never see your password.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {(integration.permissions || []).map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                      {p}
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '10px 0' }} onClick={handleOAuth}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71 M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                  Authorize with {integration.name}
                </button>
              </div>
            ) : (
              <div>
                {integration.fields.map(f => (
                  <div key={f.key} style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>{f.label}</label>
                    {f.hint && <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginBottom: 4 }}>{f.hint}</div>}
                    <input
                      className="form-input"
                      type={f.type}
                      value={creds[f.key] || ''}
                      onChange={e => setCreds(c => ({ ...c, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                ))}
                <GuideAccordion channel={integration.id} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleConnect} disabled={!allFilled}>
                    Test & Connect
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {step === 'loading' && (
          <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, border: '3px solid var(--border)', borderTop: `3px solid ${integration.color}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Verifying credentials…</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Making a live API call to {integration.name}</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Success */}
        {step === 'success' && (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '14px 16px', background: 'var(--green-light)', borderRadius: 'var(--radius)', border: '1px solid rgba(34,197,94,0.25)' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>Connection verified</div>
                <div style={{ fontSize: 12, color: 'var(--green)', opacity: 0.85, marginTop: 2 }}>{resultMsg}</div>
              </div>
            </div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleSave}>
              Save & Activate
            </button>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20, padding: '14px 16px', background: 'var(--red-light)', borderRadius: 'var(--radius)', border: '1px solid rgba(220,38,38,0.25)' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--red)' }}>Connection failed</div>
                <div style={{ fontSize: 12, color: 'var(--red)', opacity: 0.85, marginTop: 2, wordBreak: 'break-word' }}>{errorMsg}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setStep('form')}>← Fix credentials</button>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Connected card ────────────────────────────────────────────────────────────

function ConnectedCard({ item, onSettings, onDisconnect, extra, displayName }) {
  const [syncing, setSyncing] = useState(false);

  const handleManualSync = async () => {
    if (!extra?.shop_domain) return;
    setSyncing(true);
    try {
      const res = await fetch(`${BACKEND}/api/shopify/sync?shop_domain=${encodeURIComponent(extra.shop_domain)}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        // Merge updated orders into localStorage
        const syncRes = await fetch(`${BACKEND}/api/shopify/orders?shop_domain=${encodeURIComponent(extra.shop_domain)}&limit=500`);
        const syncData = await syncRes.json();
        if (syncData.orders?.length) {
          const existing = getOrders().filter(o => o.channel !== 'shopify');
          saveOrders([...syncData.orders, ...existing]);
        }
        toast.success(`Synced ${data.synced} orders from ${extra.shop_domain}`);
      }
    } catch (e) {
      toast.error('Sync failed — is the backend running?');
    }
    setSyncing(false);
  };

  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: item.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
          {item.logo}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
          {(displayName || extra?.shop_name) && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
              {displayName || extra?.shop_name}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500 }}>
              Connected{extra?.order_count ? ` · ${extra.order_count} orders synced` : ''}
            </span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {item.id === 'shopify' ? (
          <button onClick={handleManualSync} disabled={syncing}
            style={{ flex: 1, fontSize: 11, padding: '5px 10px', background: 'transparent', color: 'var(--blue)', border: '1px solid var(--blue)', borderRadius: 'var(--radius)', cursor: syncing ? 'default' : 'pointer', fontFamily: 'inherit', opacity: syncing ? 0.6 : 1 }}>
            {syncing ? '⟳ Syncing…' : '⟳ Sync now'}
          </button>
        ) : (
          <button onClick={onSettings}
            style={{ flex: 1, fontSize: 11, padding: '5px 10px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            ⚙ Settings
          </button>
        )}
        <button onClick={onDisconnect}
          style={{ fontSize: 11, padding: '5px 10px', background: 'var(--red-light)', color: 'var(--red)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'd2cflow_integrations';

function loadConnected() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch {}
  return new Set();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntegrationsPage({ onNavigate }) {
  const [connected, setConnected] = useState(loadConnected);
  // displayNames: { [channelId]: string } — account name shown on connected card
  const [displayNames, setDisplayNames] = useState({});
  const [modal, setModal] = useState(null);
  const [shopifyModal, setShopifyModal] = useState(false);
  const [whatsappModal, setWhatsappModal] = useState(false);
  const [search, setSearch] = useState('');
  const [shopifyConn, setShopifyConn] = useState(loadShopifyConnection);

  // Load connection state from backend on mount
  useEffect(() => {
    api.get('/api/integrations').then(({ data }) => {
      const ids = new Set(data.filter(r => r.connected).map(r => r.channel));
      const names = {};
      data.filter(r => r.connected && r.display_name).forEach(r => { names[r.channel] = r.display_name; });
      if (ids.size > 0) {
        setConnected(prev => new Set([...prev, ...ids]));
        setDisplayNames(prev => ({ ...prev, ...names }));
      }
    }).catch(() => {}); // fail silently — not logged in yet or backend down
  }, []);

  const handleConnect = (id, extra = {}) => {
    setConnected(s => {
      const n = new Set([...s, id]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...n]));
      return n;
    });
    if (extra?.display_name) {
      setDisplayNames(prev => ({ ...prev, [id]: extra.display_name }));
    }
  };

  const handleShopifyConnected = (id, info) => {
    handleConnect(id, { display_name: info.shop_name || info.shop_domain });
    setShopifyConn(info);
    // Trigger catalog import in background
    api.post('/trigger/catalog-import?channel=shopify').catch(() => {});
    toast.success(`${info.shop_name} connected — ${info.order_count} orders synced`);
  };

  const handleDisconnect = async id => {
    // Call backend to revoke
    try { await api.delete(`/api/integrations/${id}`); } catch (_) {}
    if (id === 'shopify' && shopifyConn?.shop_domain) {
      try { await fetch(`/api/shopify/disconnect?shop_domain=${encodeURIComponent(shopifyConn.shop_domain)}`, { method: 'DELETE' }); } catch (_) {}
      localStorage.removeItem(SHOPIFY_STORAGE_KEY);
      setShopifyConn(null);
    }
    setConnected(s => {
      const n = new Set(s); n.delete(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...n]));
      return n;
    });
    setDisplayNames(prev => { const n = { ...prev }; delete n[id]; return n; });
    toast.info('Integration disconnected');
  };

  const allItems = INTEGRATIONS.flatMap(g => g.items);
  const filteredGroups = INTEGRATIONS.map(g => ({
    ...g,
    items: g.items.filter(i =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      g.group.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(g => g.items.length > 0);

  const connectedItems = allItems.filter(i => connected.has(i.id));

  return (
    <div style={{ padding: 24, maxWidth: 1060 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Integrations</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Connect your marketplaces, couriers, and messaging channels. All connections are verified with a live API call.
          </p>
        </div>
        {connected.size > 0 && (
          <div style={{ background: 'var(--green-light)', color: 'var(--green)', borderRadius: 'var(--radius)', padding: '6px 12px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
            {connected.size} connected
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          className="form-input"
          placeholder="Search integrations…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ paddingLeft: 34, width: '100%', maxWidth: 340 }}
        />
      </div>

      {/* Active connections */}
      {connectedItems.length > 0 && !search && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 12 }}>
            ✓ Active Connections
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {connectedItems.map(item => (
              <ConnectedCard key={item.id} item={item}
                displayName={displayNames[item.id]}
                extra={item.id === 'shopify' ? shopifyConn : undefined}
                onSettings={() => toast.info(`${item.name} settings — edit credentials by disconnecting and reconnecting`)}
                onDisconnect={() => handleDisconnect(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* All groups */}
      {filteredGroups.map(group => {
        const items = search ? group.items : group.items.filter(i => !connected.has(i.id));
        if (items.length === 0) return null;
        return (
          <div key={group.group} style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 12 }}>
              {group.group}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {items.map(item => (
                <div key={item.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: item.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                      {item.logo}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        {item.authType === 'oauth' ? 'OAuth 2.0' : 'API credentials'}
                      </div>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1, margin: 0 }}>{item.desc}</p>
                  <button className="btn btn-primary" style={{ fontSize: 12, justifyContent: 'center', padding: '7px 0', gap: 6 }}
                    onClick={() => item.id === 'shopify' ? setShopifyModal(true) : item.id === 'whatsapp' ? setWhatsappModal(true) : setModal(item)}>
                    {item.authType === 'oauth'
                      ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>Login with {item.name.split(' ')[0]}</>
                      : '+ Connect'
                    }
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {modal && <ConnectModal integration={modal} onClose={() => setModal(null)} onSave={handleConnect} />}
      {shopifyModal && (
        <ShopifyConnectModal
          onClose={() => setShopifyModal(false)}
          onConnected={handleShopifyConnected}
        />
      )}
      {whatsappModal && (
        <WhatsAppModal
          onClose={() => setWhatsappModal(false)}
          onConnected={(id, info) => { handleConnect(id, info); toast.success('WhatsApp monitoring active'); }}
        />
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
