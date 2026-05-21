import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STORES } from '../data/stores'
import { getCustomStores } from '../data/customStores'

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export default function RecentScansView({ onBack }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadRecent()
  }, [])

  async function loadRecent() {
    setLoading(true)
    setError('')
    try {
      // Get most recently scanned products
      const { data: products, error: prodErr } = await supabase
        .from('products')
        .select('*')
        .order('last_scanned_at', { ascending: false })
        .limit(20)

      if (prodErr) throw prodErr
      if (!products || products.length === 0) {
        setItems([])
        setLoading(false)
        return
      }

      // For each product, get its latest observation (price + store)
      const upcs = products.map(p => String(p.upc))
      const { data: obs, error: obsErr } = await supabase
        .from('observations')
        .select('barcode, price, store_id, created_at')
        .in('barcode', upcs)
        .order('created_at', { ascending: false })

      if (obsErr) throw obsErr

      // Pick latest observation per UPC
      const latestByUpc = {}
      for (const o of obs || []) {
        if (!latestByUpc[o.barcode]) latestByUpc[o.barcode] = o
      }

      const allStores = [...STORES, ...getCustomStores()]

      const enriched = products.map(p => {
        const latest = latestByUpc[String(p.upc)]
        const store = latest ? allStores.find(s => s.id === latest.store_id) : null
        return {
          ...p,
          latestPrice: latest?.price,
          latestStore: store?.name || latest?.store_id,
          latestAt: latest?.created_at,
        }
      })

      setItems(enriched)
    } catch (err) {
      setError(err.message || 'Could not load recent scans')
    }
    setLoading(false)
  }

  return (
    <div className="recent-view">
      <button className="back-btn" onClick={onBack}>← Back</button>

      <div className="recent-header">
        <h2 className="recent-title">📦 Recently Scanned</h2>
        <p className="recent-sub">Real items, real people, real prices.</p>
      </div>

      {loading && (
        <p className="recent-loading">Loading the catalog…</p>
      )}

      {!loading && error && (
        <div className="recent-empty">
          <p style={{ color: '#C62828' }}>{error}</p>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="recent-empty">
          <p className="recent-empty-emoji">🐿️</p>
          <p className="recent-empty-title">Nothing scanned yet</p>
          <p className="recent-empty-sub">
            Hit the 📷 Scan button up top and watch this list grow.
          </p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="recent-list">
          {items.map(item => (
            <div key={item.upc} className="recent-card">
              {item.image_url ? (
                <img src={item.image_url} alt={item.name} className="recent-thumb" />
              ) : (
                <div className="recent-thumb recent-thumb-placeholder">🛒</div>
              )}
              <div className="recent-info">
                <div className="recent-name">{item.name}</div>
                {item.brand && <div className="recent-brand">{item.brand}</div>}
                {item.category && <div className="recent-cat">{item.category}</div>}
                {item.latestPrice != null && (
                  <div className="recent-price-row">
                    <span className="recent-price">${Number(item.latestPrice).toFixed(2)}</span>
                    <span className="recent-store">at {item.latestStore}</span>
                    <span className="recent-when">{timeAgo(item.latestAt)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
