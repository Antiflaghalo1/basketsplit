import { useEffect, useState } from 'react'
import { MapPin, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getAllStores } from '../data/storeService'

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180,
    dLng = (lng2 - lng1) * Math.PI / 180,
    a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function HomeView({ user, firstName, budget, onBudgetNav, onSeeAll }) {
  const [stores, setStores] = useState([])
  const [recentProducts, setRecentProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [deals, setDeals] = useState([])

  const budgetNum = parseFloat(budget) || 0

  useEffect(() => {
    getAllStores().then(rawStores => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude: lat, longitude: lng } = pos.coords
          const withCoords = rawStores.filter(s => s.lat != null && s.lng != null)
          const noCoords = rawStores.filter(s => s.lat == null || s.lng == null)
          withCoords.sort((a, b) => haversine(lat, lng, a.lat, a.lng) - haversine(lat, lng, b.lat, b.lng))
          setStores([...withCoords, ...noCoords])
        },
        () => setStores(rawStores),
        { timeout: 8000 }
      )
    })
    loadRecent()
    loadDeals()
  }, [])

  async function loadDeals() {
    try {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('flipp_observations')
        .select('product_name, store_id, price, valid_to, sale_type')
        .gt('price', 0)
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .order('price', { ascending: true })
        .limit(20)
      setDeals(data || [])
    } catch {
      setDeals([])
    }
  }

  async function loadRecent() {
    setLoading(true)
    try {
      const { data: products } = await supabase
        .from('products')
        .select('upc, name, image_url, normalized_category, category, last_scanned_at')
        .order('last_scanned_at', { ascending: false })
        .limit(4)

      if (!products || products.length === 0) {
        setRecentProducts([])
        setLoading(false)
        return
      }

      const upcs = products.map(p => String(p.upc))
      const { data: obs } = await supabase
        .from('observations')
        .select('barcode, price, created_at')
        .in('barcode', upcs)
        .order('created_at', { ascending: false })

      const latestPriceByUpc = {}
      for (const o of obs || []) {
        if (!(o.barcode in latestPriceByUpc) && o.price > 0 && o.price <= 500) {
          latestPriceByUpc[o.barcode] = o.price
        }
      }

      setRecentProducts(products.map(p => ({
        ...p,
        latestPrice: latestPriceByUpc[String(p.upc)] ?? null,
      })))
    } catch {
      setRecentProducts([])
    }
    setLoading(false)
  }

  const storeNameMap = Object.fromEntries(stores.map(s => [String(s.id), s.name]))

  return (
    <div className="home-view">
      {/* Section 1 — Greeting */}
      <div className="home-greeting-section">
        <div className="home-greeting">{firstName ? `Hey ${firstName} 👋` : 'Hey there 👋'}</div>
        {budgetNum > 0 ? (
          <div className="home-budget-pill">💰 ${budgetNum}/week</div>
        ) : (
          <button className="home-budget-pill home-budget-pill-cta" onClick={onBudgetNav}>
            💰 Set your budget →
          </button>
        )}
      </div>

      {/* Section 2 — Stores Near You */}
      <div className="home-section">
        <div className="home-section-header">
          <div className="home-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={16} color="var(--green)" /> Stores Near You</div>
          <div className="home-section-sub">Tap to explore prices</div>
        </div>
        <div className="home-stores-scroll">
          {stores.map(store => (
            <div
              key={store.id}
              className="home-store-card"
              style={{ '--store-color': store.color }}
              onClick={() => console.log('store:', store.id)}
            >
              <div className="home-store-name">{store.name}</div>
              <div className="home-store-loc">{store.location}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2.5 — This Week's Deals */}
      {deals.length > 0 && (
        <div className="home-section">
          <div className="home-section-header">
            <div className="home-section-title" style={{ color: 'var(--green)' }}>This Week's Deals 🏷️</div>
            <div className="home-section-sub">From local store circulars</div>
          </div>
          <div className="home-deals-scroll">
            {deals.map((deal, i) => (
              <div key={i} className="home-deal-card">
                <div className="home-deal-name">{deal.product_name}</div>
                <div className="home-deal-price">${Number(deal.price).toFixed(2)}</div>
                <div className="home-deal-store">{storeNameMap[String(deal.store_id)] || deal.store_id}</div>
                <span className="sale-badge">🏷️ Sale</span>
                {deal.sale_type && <div className="home-deal-type">{deal.sale_type}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3 — Recently Scanned */}
      <div className="home-section">
        <div className="home-section-header-row">
          <div className="home-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={16} color="var(--green)" /> Recently Scanned</div>
          <button className="home-see-all" onClick={onSeeAll}>See all →</button>
        </div>
        {loading ? (
          <p className="home-recent-loading">Loading…</p>
        ) : recentProducts.length === 0 ? (
          <p className="home-recent-empty">No scans yet. Tap 📷 to get started.</p>
        ) : (
          <div className="home-recent-list">
            {recentProducts.map(item => (
              <div key={item.upc} className="home-recent-item">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="home-recent-thumb" />
                ) : (
                  <div className="home-recent-thumb home-recent-thumb-placeholder">🛒</div>
                )}
                <div className="home-recent-info">
                  <div className="home-recent-name">{item.name}</div>
                  {(item.normalized_category || item.category) && (
                    <div className="home-recent-cat">{item.normalized_category || item.category}</div>
                  )}
                  {item.latestPrice != null && (
                    <div className="home-recent-price">${item.latestPrice.toFixed(2)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
