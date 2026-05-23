import { useEffect, useState } from 'react'
import { Heart, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getAllStores } from '../data/storeService'
import { getCustomStores } from '../data/customStores'
import { saveItem, removeSavedItem } from '../data/savedItems'
import ReportModal from './ReportModal'

const CAT_META = {
  'Dairy & Eggs':          { emoji: '🥛', bg: '#E1F5EE', dot: '#1D9E75' },
  'Meat & Seafood':        { emoji: '🥩', bg: '#FAECE7', dot: '#D85A30' },
  'Produce':               { emoji: '🥦', bg: '#EAF3DE', dot: '#639922' },
  'Bakery & Bread':        { emoji: '🥖', bg: '#FAEEDA', dot: '#BA7517' },
  'Snacks & Candy':        { emoji: '🍿', bg: '#FBEAF0', dot: '#D4537E' },
  'Beverages':             { emoji: '🧃', bg: '#E6F1FB', dot: '#378ADD' },
  'Health & Beauty':       { emoji: '💊', bg: '#EEEDFE', dot: '#7F77DD' },
  'Household & Cleaning':  { emoji: '🧹', bg: '#F1EFE8', dot: '#888780' },
  'Baby & Kids':           { emoji: '🍼', bg: '#FBEAF0', dot: '#D4537E' },
  'Breakfast & Cereal':    { emoji: '🥣', bg: '#FAEEDA', dot: '#BA7517' },
  'Frozen Foods':          { emoji: '🧊', bg: '#E6F1FB', dot: '#378ADD' },
  'Pantry & Canned':       { emoji: '🥫', bg: '#FAECE7', dot: '#D85A30' },
  'Miscellaneous':         { emoji: '🛒', bg: '#F1EFE8', dot: '#888780' },
}

function cardFreshness(products) {
  if (products.length === 0) return { dot: '#888780', label: 'No scans yet', color: '#888780' }
  const mostRecent = products[0]?.last_scanned_at
  if (!mostRecent) return { dot: '#888780', label: 'No scans yet', color: '#888780' }
  const days = (Date.now() - new Date(mostRecent).getTime()) / 86400000
  if (days <= 7)  return { dot: '#1D9E75', label: 'Fresh',  color: '#1D9E75' }
  if (days <= 30) return { dot: '#BA7517', label: 'Aging',  color: '#BA7517' }
  return { dot: '#888780', label: 'Stale', color: '#888780' }
}

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

export default function CategoriesView({ onBack, userId, savedUpcs = new Set(), onItemSaved, onItemRemoved }) {
  const [stores, setStores] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [obsMap, setObsMap] = useState({})
  const [expandedPrices, setExpandedPrices] = useState(new Set())
  const [reportTarget, setReportTarget] = useState(null)

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

    setGroups(Object.values(groupMap).sort((a, b) => a.name.localeCompare(b.name)))
    setLoading(false)
  }

  async function loadGroupObs(groupName) {
    const group = groups.find(g => g.name === groupName)
    if (!group) return
    const upcs = group.products.map(p => String(p.upc))
    const today = new Date().toISOString().split('T')[0]

    const [{ data: obs }, { data: flippRows }] = await Promise.all([
      supabase
        .from('observations')
        .select('barcode, price, store_id, created_at')
        .in('barcode', upcs)
        .eq('voided', false),
      supabase
        .from('flipp_observations')
        .select('barcode, store_id, price, valid_to')
        .in('barcode', upcs)
        .gt('price', 0)
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .order('price', { ascending: true }),
    ])

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

    const map = {}
    for (const upc of upcs) {
      const upcObs = obsByUpc[upc] || []
      const validObs = upcObs.filter(o => o.price > 0 && o.price <= 500)
      const avgPrice = validObs.length > 0
        ? validObs.reduce((sum, o) => sum + o.price, 0) / validObs.length
        : null
      const top3 = [...validObs].sort((a, b) => a.price - b.price).slice(0, 3)
      const storeCount = new Set(validObs.map(o => o.store_id)).size
      const flippBest = flippBestByUpc[upc]
      const communityLowest = top3[0]?.price
      const flippSale = (communityLowest != null && flippBest && flippBest.price < communityLowest)
        ? flippBest
        : null
      map[upc] = { avgPrice, top3, storeCount, flippSale }
    }
    setObsMap(map)
  }

  if (expanded) {
    const group = groups.find(g => g.name === expanded)
    return (
      <div className="categories-view">
        {reportTarget && (
          <ReportModal
            targetId={reportTarget.targetId}
            targetName={reportTarget.targetName}
            userId={userId}
            onClose={() => setReportTarget(null)}
          />
        )}
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
                      {intel.flippSale && (
                        <div>
                          <span className="sale-badge">🏷️ Sale: ${intel.flippSale.price.toFixed(2)}</span>
                          {intel.flippSale.valid_to && (
                            <span className="sale-until"> until {formatDate(intel.flippSale.valid_to)}</span>
                          )}
                        </div>
                      )}
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
                      className={savedUpcs.has(String(item.upc)) ? 'save-heart-btn save-heart-btn-saved' : 'save-heart-btn'}
                      onClick={() => {
                        const upc = String(item.upc)
                        if (savedUpcs.has(upc)) {
                          removeSavedItem(userId, upc)
                          onItemRemoved?.(upc)
                        } else {
                          saveItem(userId, item)
                          onItemSaved?.(item)
                        }
                      }}
                    >
                      {savedUpcs.has(String(item.upc))
                        ? <><Heart size={13} fill="currentColor" /> Saved</>
                        : <><Heart size={13} /> Save</>}
                    </button>
                    <button
                      className="save-heart-btn"
                      onClick={() => setReportTarget({ targetId: String(item.upc), targetName: item.name })}
                    >
                      <AlertTriangle size={13} /> Report
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
      <div className="cat-page-header">
        <span className="cat-emoji-pill">🗂️</span>
        <h2 className="categories-title">Categories</h2>
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
          {groups.map(g => {
            const meta = CAT_META[g.name] || CAT_META['Miscellaneous']
            const fresh = cardFreshness(g.products)
            return (
              <button
                key={g.name}
                className="cat-card"
                onClick={() => setExpanded(g.name)}
              >
                <div className="cat-card-top" style={{ background: meta.bg }}>
                  <span className="cat-card-emoji-fade">{meta.emoji}</span>
                  <span className="cat-card-emoji-main">{meta.emoji}</span>
                </div>
                <div className="cat-card-body">
                  <div className="cat-card-name">{g.name}</div>
                  <div className="cat-card-meta">
                    <span className="cat-card-count">
                      {g.products.length} item{g.products.length !== 1 ? 's' : ''}
                    </span>
                    <span className="cat-card-freshness" style={{ color: fresh.color }}>
                      <span className="cat-card-dot" style={{ background: fresh.dot }} />
                      {fresh.label}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
