import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getAllStores } from '../data/storeService'
import { getCustomStores } from '../data/customStores'
import { saveItem } from '../data/savedItems'

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

export default function CategoriesView({ onBack, userId, savedUpcs = new Set(), onItemSaved }) {
  const [stores, setStores] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [obsMap, setObsMap] = useState({})
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
    load()
  }, [])

  useEffect(() => {
    if (!expanded) {
      setObsMap({})
      setExpandedPrices(new Set())
      return
    }
    loadGroupObs(expanded)
  }, [expanded])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('products')
      .select('upc, name, brand, category, normalized_category, image_url, last_scanned_at')
      .order('last_scanned_at', { ascending: false })

    if (!data || data.length === 0) {
      setGroups([])
      setLoading(false)
      return
    }

    const groupMap = {}
    for (const p of data) {
      const key = p.normalized_category || 'Miscellaneous'
      if (!groupMap[key]) groupMap[key] = { name: key, products: [], thumbnail: null }
      groupMap[key].products.push(p)
      if (!groupMap[key].thumbnail && p.image_url) groupMap[key].thumbnail = p.image_url
    }

    setGroups(Object.values(groupMap))
    setLoading(false)
  }

  async function loadGroupObs(groupName) {
    const group = groups.find(g => g.name === groupName)
    if (!group) return
    const upcs = group.products.map(p => String(p.upc))
    const { data: obs } = await supabase
      .from('observations')
      .select('barcode, price, store_id, created_at')
      .in('barcode', upcs)

    const obsByUpc = {}
    for (const o of obs || []) {
      if (!obsByUpc[o.barcode]) obsByUpc[o.barcode] = []
      obsByUpc[o.barcode].push(o)
    }

    const map = {}
    for (const upc of upcs) {
      const upcObs = obsByUpc[upc] || []
      const validObs = upcObs.filter(o => o.price > 0 && o.price <= 500)
      const avgPrice = validObs.length > 0
        ? validObs.reduce((sum, o) => sum + o.price, 0) / validObs.length
        : null
      const top3 = [...validObs].sort((a, b) => a.price - b.price).slice(0, 3)
      const storeCount = new Set(validObs.map(o => o.store_id)).size
      map[upc] = { avgPrice, top3, storeCount }
    }
    setObsMap(map)
  }

  if (expanded) {
    const group = groups.find(g => g.name === expanded)
    return (
      <div className="categories-view">
        <button className="back-btn" onClick={() => setExpanded(null)}>← Categories</button>
        <div className="categories-header">
          <h2 className="categories-title">{group.name}</h2>
          <p className="categories-sub">
            {group.products.length} product{group.products.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="recent-list">
          {group.products.map(item => {
            const intel = obsMap[String(item.upc)]
            const badge = freshnessBadge(item.last_scanned_at)
            const lowestEntry = intel?.top3?.[0]
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
                  {item.category && <div className="recent-cat">{item.category}</div>}
                  {intel && intel.storeCount > 0 && lowestEntry && (
                    <div className="price-intel-row">
                      <div className="price-intel-main">
                        {intel.storeCount > 1
                          ? <span className="price-intel-store-count">From ${lowestEntry.price.toFixed(2)} across {intel.storeCount} stores</span>
                          : <span>From ${lowestEntry.price.toFixed(2)} at {lowestStore}</span>
                        }
                        <span className={`freshness-badge ${badge.cls}`}>{badge.label}</span>
                      </div>
                      <button className="top3-toggle" onClick={() => togglePrices(item.upc)}>
                        {expandedPrices.has(item.upc) ? '▲ Hide' : '▼ Best prices'}
                      </button>
                      {expandedPrices.has(item.upc) && (
                        <div className="top3-list">
                          {intel.top3.map((entry, i) => {
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
                  <div className="saved-action-row">
                    <button
                      className="save-heart-btn"
                      style={savedUpcs.has(String(item.upc)) ? { color: 'var(--green)' } : {}}
                      onClick={() => {
                        if (!savedUpcs.has(String(item.upc))) {
                          saveItem(userId, item)
                          onItemSaved?.(item)
                        }
                      }}
                    >
                      {savedUpcs.has(String(item.upc)) ? '♥ Saved' : '♡ Save'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="categories-view">
      <button className="back-btn" onClick={onBack}>← Back</button>
      <div className="categories-header">
        <h2 className="categories-title">🗂️ Categories</h2>
        <p className="categories-sub">Built from real community scans</p>
      </div>

      {loading && <p className="recent-loading">Loading categories…</p>}

      {!loading && groups.length === 0 && (
        <div className="recent-empty">
          <p className="recent-empty-title">Nothing here yet — start scanning! 🐿️</p>
        </div>
      )}

      {!loading && groups.length > 0 && (
        <div className="categories-grid">
          {groups.map(g => (
            <button
              key={g.name}
              className="cat-card"
              onClick={() => setExpanded(g.name)}
            >
              {g.thumbnail && (
                <div
                  className="cat-card-bg"
                  style={{ backgroundImage: `url(${g.thumbnail})` }}
                />
              )}
              <div className="cat-card-name">{g.name}</div>
              <div className="cat-card-count">
                {g.products.length} item{g.products.length !== 1 ? 's' : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
