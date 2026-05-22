import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getAllStores } from '../data/storeService'
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

function freshnessBadge(ts) {
  const days = (Date.now() - new Date(ts).getTime()) / 86400000
  if (days <= 7) return { label: '🟢 Fresh', cls: 'freshness-fresh' }
  if (days <= 30) return { label: '🟡 Aging', cls: 'freshness-aging' }
  return { label: '🔴 Stale', cls: 'freshness-stale' }
}

function formatDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function RecentScansView({ onBack, userId }) {
  const [stores, setStores] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedPrices, setExpandedPrices] = useState(new Set())

  const allStores = [...stores, ...getCustomStores()]

  function togglePrices(upc) {
    setExpandedPrices(prev => {
      const next = new Set(prev)
      if (next.has(upc)) next.delete(upc)
      else next.add(upc)
      return next
    })
  }

  useEffect(() => {
    getAllStores().then(setStores)
  }, [])

  useEffect(() => {
    loadRecent()
  }, [userId])

  async function loadRecent() {
    setLoading(true)
    setError('')
    try {
      let products

      if (userId) {
        const { data: userObs, error: obsUserErr } = await supabase
          .from('observations')
          .select('barcode')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20)

        if (obsUserErr) throw obsUserErr
        if (!userObs || userObs.length === 0) {
          setItems([])
          setLoading(false)
          return
        }

        const uniqueBarcodes = [...new Set(userObs.map(o => o.barcode))]
        const { data: prodData, error: prodErr } = await supabase
          .from('products')
          .select('*')
          .in('upc', uniqueBarcodes)

        if (prodErr) throw prodErr
        products = prodData
      } else {
        const { data: prodData, error: prodErr } = await supabase
          .from('products')
          .select('*')
          .order('last_scanned_at', { ascending: false })
          .limit(20)

        if (prodErr) throw prodErr
        products = prodData
      }

      if (!products || products.length === 0) {
        setItems([])
        setLoading(false)
        return
      }

      const upcs = products.map(p => String(p.upc))
      const today = new Date().toISOString().split('T')[0]
      let obsQuery = supabase
        .from('observations')
        .select('barcode, price, store_id, created_at')
        .in('barcode', upcs)
        .order('created_at', { ascending: false })
      if (userId) obsQuery = obsQuery.eq('user_id', userId)

      const [{ data: obs, error: obsErr }, { data: flippRows }] = await Promise.all([
        obsQuery,
        supabase
          .from('flipp_observations')
          .select('barcode, store_id, price, valid_to')
          .in('barcode', upcs)
          .gt('price', 0)
          .or(`valid_to.is.null,valid_to.gte.${today}`)
          .order('price', { ascending: true }),
      ])

      if (obsErr) throw obsErr

      const obsByUpc = {}
      for (const o of obs || []) {
        if (!obsByUpc[o.barcode]) obsByUpc[o.barcode] = []
        obsByUpc[o.barcode].push(o)
      }

      const flippBestByUpc = {}
      for (const row of flippRows || []) {
        if (!flippBestByUpc[row.barcode]) {
          flippBestByUpc[row.barcode] = { price: row.price, valid_to: row.valid_to }
        }
      }

      const enriched = products.map(p => {
        const upcObs = obsByUpc[String(p.upc)] || []
        const validObs = upcObs.filter(o => o.price > 0 && o.price <= 500)
        const avgPrice = validObs.length > 0
          ? validObs.reduce((sum, o) => sum + o.price, 0) / validObs.length
          : null
        const top3 = [...validObs].sort((a, b) => a.price - b.price).slice(0, 3)
        const storeCount = new Set(validObs.map(o => o.store_id)).size
        const flippBest = flippBestByUpc[String(p.upc)]
        const communityLowest = top3[0]?.price
        const flippSale = (communityLowest != null && flippBest && flippBest.price < communityLowest)
          ? flippBest
          : null
        return { ...p, avgPrice, top3, storeCount, flippSale }
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
          {items.map(item => {
            const badge = freshnessBadge(item.last_scanned_at)
            const lowestEntry = item.top3?.[0]
            const lowestStore = lowestEntry
              ? allStores.find(s => s.id === lowestEntry.store_id)?.name || lowestEntry.store_id
              : null
            return (
              <div key={item.upc} className="recent-card">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="recent-thumb" />
                ) : (
                  <div className="recent-thumb recent-thumb-placeholder">🛒</div>
                )}
                <div className="recent-info">
                  <div className="recent-name">{item.name}</div>
                  {item.brand && <div className="recent-brand">{item.brand}</div>}
                  {(item.normalized_category || item.category) && (
                    <div className="recent-cat">{item.normalized_category || item.category}</div>
                  )}
                  {item.storeCount > 0 && lowestEntry && (
                    <div className="price-intel-row">
                      <div className="price-intel-main">
                        {item.storeCount > 1
                          ? <span className="price-intel-store-count">From ${lowestEntry.price.toFixed(2)} across {item.storeCount} stores</span>
                          : <span>From ${lowestEntry.price.toFixed(2)} at {lowestStore}</span>
                        }
                        <span className={`freshness-badge ${badge.cls}`}>{badge.label}</span>
                      </div>
                      {item.flippSale && (
                        <div>
                          <span className="sale-badge">🏷️ Sale: ${item.flippSale.price.toFixed(2)}</span>
                          {item.flippSale.valid_to && (
                            <span className="sale-until"> until {formatDate(item.flippSale.valid_to)}</span>
                          )}
                        </div>
                      )}
                      <button className="top3-toggle" onClick={() => togglePrices(item.upc)}>
                        {expandedPrices.has(item.upc) ? '▲ Hide' : '▼ Best prices'}
                      </button>
                      {expandedPrices.has(item.upc) && (
                        <div className="top3-list">
                          {item.top3.map((entry, i) => {
                            const storeName = allStores.find(s => s.id === entry.store_id)?.name || entry.store_id
                            return (
                              <div key={i} className="top3-row">
                                ${entry.price.toFixed(2)} · {storeName} · {timeAgo(entry.created_at)}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
