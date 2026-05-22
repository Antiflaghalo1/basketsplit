import { useEffect, useState } from 'react'
import { MapPin, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { STORES } from '../data/stores'

export default function HomeView({ user, firstName, budget, onBudgetNav, onSeeAll }) {
  const [recentProducts, setRecentProducts] = useState([])
  const [loading, setLoading] = useState(true)

  const budgetNum = parseFloat(budget) || 0

  useEffect(() => {
    loadRecent()
  }, [])

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
          {STORES.map(store => (
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
