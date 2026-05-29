import { useState, useEffect, useRef } from 'react'
import { Search, Heart, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getAllStores } from '../data/storeService'
import ReportModal from './ReportModal'

function categoryEmoji(name) {
  const n = (name || '').toLowerCase()
  if (/watermelon|apple|banana|grape|berry|strawberr|blueberr|raspberr|peach|pear|mango|pineapple|orange|lemon|lime|cherry|melon|avocado|tomato|lettuce|spinach|kale|broccoli|carrot|celery|pepper|cucumber|zucchini|mushroom|onion|garlic|potato|corn|peas|bean|asparagus|cauliflower/.test(n)) return '🥬'
  if (/chicken|beef|pork|turkey|salmon|tuna|shrimp|steak|ground|sausage|bacon|ham|lamb|fish|seafood|tilapia|cod|crab|lobster/.test(n)) return '🥩'
  if (/milk|yogurt|cheese|butter|cream|dairy|egg/.test(n)) return '🥛'
  if (/bread|bagel|muffin|croissant|bun|roll|tortilla|wrap|pita|cake|cookie|brownie|pastry/.test(n)) return '🥖'
  if (/juice|water|soda|pop|drink|tea|coffee|lemonade|cola|beer|wine|sparkling/.test(n)) return '🥤'
  if (/chip|cracker|pretzel|popcorn|snack|nut|almond|cashew|granola|trail mix/.test(n)) return '🍿'
  if (/frozen|ice cream|pizza|waffle|burrito/.test(n)) return '🧊'
  if (/pasta|noodle|rice|quinoa|oat|cereal|flour|sugar|oil|sauce|soup|canned|salsa|peanut butter|jelly|jam|mayo|mustard|ketchup|vinegar|syrup/.test(n)) return '🥫'
  return '🛒'
}

function freshnessBadge(ts) {
  const days = (Date.now() - new Date(ts).getTime()) / 86400000
  if (days <= 7) return { label: '🟢 Fresh', cls: 'freshness-fresh' }
  if (days <= 30) return { label: '🟡 Aging', cls: 'freshness-aging' }
  return { label: '🔴 Stale', cls: 'freshness-stale' }
}

const PAGE_SIZE = 10

export default function SearchView({ onBack, onStoreSelect }) {
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState([])
  const [deals, setDeals] = useState([])
  const [storeResults, setStoreResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [stores, setStores] = useState([])
  const [selectedDeal, setSelectedDeal] = useState(null)
  const [reportTarget, setReportTarget] = useState(null)
  const [hasMoreCommunity, setHasMoreCommunity] = useState(false)
  const [hasMoreDeals, setHasMoreDeals] = useState(false)
  const [loadingMoreCommunity, setLoadingMoreCommunity] = useState(false)
  const [loadingMoreDeals, setLoadingMoreDeals] = useState(false)
  const [communityOffset, setCommunityOffset] = useState(0)
  const [dealsOffset, setDealsOffset] = useState(0)
  const inputRef = useRef(null)
  const timerRef = useRef(null)
  const currentQueryRef = useRef('')
  const flippSeenRef = useRef(new Map())

  useEffect(() => {
    getAllStores().then(setStores)
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    clearTimeout(timerRef.current)
    currentQueryRef.current = ''
    if (!query.trim()) {
      setProducts([])
      setDeals([])
      setStoreResults([])
      setSelectedDeal(null)
      setSearched(false)
      setLoading(false)
      setHasMoreCommunity(false)
      setHasMoreDeals(false)
      setCommunityOffset(0)
      setDealsOffset(0)
      flippSeenRef.current = new Map()
      return
    }
    setProducts([])
    setDeals([])
    setStoreResults([])
    setSelectedDeal(null)
    setHasMoreCommunity(false)
    setHasMoreDeals(false)
    setCommunityOffset(0)
    setDealsOffset(0)
    flippSeenRef.current = new Map()
    setLoading(true)
    const q = query.trim()
    timerRef.current = setTimeout(() => {
      currentQueryRef.current = q
      runSearch(q)
    }, 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  async function runSearch(q) {
    const today = new Date().toISOString().split('T')[0]
    const [{ data: prodData }, { data: flippData }, { data: storeData }] = await Promise.all([
      supabase
        .from('products')
        .select('upc, name, image_url, normalized_category, category')
        .ilike('name', `%${q}%`)
        .order('name', { ascending: true })
        .order('upc', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      supabase
        .from('flipp_observations')
        .select('product_name, store_id, price, regular_price, promo_description, clean_image_url, post_price_text, valid_to, merchant_name')
        .ilike('product_name', `%${q}%`)
        .gt('price', 0)
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .order('price', { ascending: true })
        .order('product_name', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      supabase
        .from('stores')
        .select('id, name, location, city, color')
        .or(`name.ilike.%${q}%,city.ilike.%${q}%,location.ilike.%${q}%`)
        .eq('verified', true)
        .limit(5),
    ])

    let enriched = prodData || []
    if (enriched.length > 0) {
      const upcs = enriched.map(p => String(p.upc))
      const { data: obs } = await supabase
        .from('observations')
        .select('barcode, price, store_id, created_at')
        .in('barcode', upcs)
        .gt('price', 0)
        .lte('price', 500)
        .order('created_at', { ascending: false })

      const latestByUpc = {}
      for (const o of obs || []) {
        if (!(o.barcode in latestByUpc)) {
          latestByUpc[o.barcode] = { price: o.price, store_id: o.store_id, created_at: o.created_at }
        }
      }
      enriched = enriched.map(p => ({
        ...p,
        latestPrice: latestByUpc[String(p.upc)]?.price ?? null,
        latestStoreId: latestByUpc[String(p.upc)]?.store_id ?? null,
        latestCreatedAt: latestByUpc[String(p.upc)]?.created_at ?? null,
      }))
    }

    if (currentQueryRef.current !== q) return

    flippSeenRef.current = new Map()
    for (const item of (flippData || [])) {
      const key = `${item.product_name}|${item.merchant_name}`
      const existing = flippSeenRef.current.get(key)
      if (!existing || item.price < existing.price) {
        flippSeenRef.current.set(key, item)
      }
    }

    setProducts(enriched)
    setDeals([...flippSeenRef.current.values()])
    setStoreResults(storeData || [])
    setHasMoreCommunity((prodData || []).length === PAGE_SIZE)
    setHasMoreDeals((flippData || []).length === PAGE_SIZE)
    setCommunityOffset(PAGE_SIZE)
    setDealsOffset(PAGE_SIZE)
    setLoading(false)
    setSearched(true)
  }

  async function loadMoreCommunity() {
    const q = query.trim()
    setLoadingMoreCommunity(true)
    const { data: prodData } = await supabase
      .from('products')
      .select('upc, name, image_url, normalized_category, category')
      .ilike('name', `%${q}%`)
      .order('name', { ascending: true })
      .order('upc', { ascending: true })
      .range(communityOffset, communityOffset + PAGE_SIZE - 1)

    let enriched = prodData || []
    if (enriched.length > 0) {
      const upcs = enriched.map(p => String(p.upc))
      const { data: obs } = await supabase
        .from('observations')
        .select('barcode, price, store_id, created_at')
        .in('barcode', upcs)
        .gt('price', 0)
        .lte('price', 500)
        .order('created_at', { ascending: false })

      const latestByUpc = {}
      for (const o of obs || []) {
        if (!(o.barcode in latestByUpc)) {
          latestByUpc[o.barcode] = { price: o.price, store_id: o.store_id, created_at: o.created_at }
        }
      }
      enriched = enriched.map(p => ({
        ...p,
        latestPrice: latestByUpc[String(p.upc)]?.price ?? null,
        latestStoreId: latestByUpc[String(p.upc)]?.store_id ?? null,
        latestCreatedAt: latestByUpc[String(p.upc)]?.created_at ?? null,
      }))
    }

    if (currentQueryRef.current !== q) {
      setLoadingMoreCommunity(false)
      return
    }

    setProducts(prev => [...prev, ...enriched])
    setHasMoreCommunity(enriched.length === PAGE_SIZE)
    setCommunityOffset(prev => prev + PAGE_SIZE)
    setLoadingMoreCommunity(false)
  }

  async function loadMoreDeals() {
    const q = query.trim()
    const today = new Date().toISOString().split('T')[0]
    setLoadingMoreDeals(true)
    const { data: flippData } = await supabase
      .from('flipp_observations')
      .select('product_name, store_id, price, regular_price, promo_description, clean_image_url, post_price_text, valid_to, merchant_name')
      .ilike('product_name', `%${q}%`)
      .gt('price', 0)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order('price', { ascending: true })
      .order('product_name', { ascending: true })
      .range(dealsOffset, dealsOffset + PAGE_SIZE - 1)

    if (currentQueryRef.current !== q) {
      setLoadingMoreDeals(false)
      return
    }

    for (const item of (flippData || [])) {
      const key = `${item.product_name}|${item.merchant_name}`
      const existing = flippSeenRef.current.get(key)
      if (!existing || item.price < existing.price) {
        flippSeenRef.current.set(key, item)
      }
    }

    setDeals([...flippSeenRef.current.values()])
    setHasMoreDeals((flippData || []).length === PAGE_SIZE)
    setDealsOffset(prev => prev + PAGE_SIZE)
    setLoadingMoreDeals(false)
  }

  const q = query.trim()
  const hasResults = products.length > 0 || deals.length > 0 || storeResults.length > 0

  return (
    <div className="search-view">
      {reportTarget && (
        <ReportModal
          targetId={reportTarget.targetId}
          targetName={reportTarget.targetName}
          onClose={() => setReportTarget(null)}
        />
      )}

      <button className="back-btn" onClick={onBack}>← Back</button>

      <div className="search-input-wrap">
        <Search size={20} className="search-icon" />
        <input
          ref={inputRef}
          className="scan-input search-main-input"
          placeholder="Search products, deals, stores…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {!q && (
        <p className="search-hint">Search for any grocery item 🔍</p>
      )}

      {q && loading && (
        <p className="search-status">Searching…</p>
      )}

      {q && !loading && searched && !hasResults && (
        <p className="search-no-results">No results for '{q}' — scan it to add it! 📷</p>
      )}

      {q && !loading && hasResults && (
        <div className="search-results">
          {storeResults.length > 0 && (
            <div className="search-section">
              <div className="search-section-title">Stores</div>
              {storeResults.map(store => (
                <div
                  key={store.id}
                  className="search-product-row"
                  style={{ cursor: 'pointer', borderLeft: `3px solid ${store.color || 'var(--green)'}`, paddingLeft: 10 }}
                  onClick={() => onStoreSelect?.(store)}
                >
                  <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{store.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{store.city || store.location}</div>
                </div>
              ))}
            </div>
          )}

          {products.length > 0 && (
            <div className="search-section">
              <div className="search-section-title">Community Scanned</div>
              <div className="recent-list">
                {products.map(item => {
                  const storeName = item.latestStoreId
                    ? stores.find(s => String(s.id) === String(item.latestStoreId))?.name || null
                    : null
                  const badge = item.latestCreatedAt ? freshnessBadge(item.latestCreatedAt) : null
                  return (
                    <div key={item.upc} className="recent-card">
                      {item.image_url
                        ? <img src={item.image_url} alt={item.name} className="recent-thumb" />
                        : <div className="recent-thumb recent-thumb-placeholder">🛒</div>
                      }
                      <div className="recent-info">
                        <div className="recent-name">{item.name}</div>
                        {(item.normalized_category || item.category) && (
                          <div className="recent-cat">{item.normalized_category || item.category}</div>
                        )}
                        {item.latestPrice != null && (
                          <div className="recent-price">${item.latestPrice.toFixed(2)}</div>
                        )}
                        {storeName && (
                          <div className="recent-cat">{storeName}</div>
                        )}
                        {badge && (
                          <span className={`freshness-badge ${badge.cls}`}>{badge.label}</span>
                        )}
                        <div className="saved-action-row">
                          <button className="save-heart-btn">
                            <Heart size={13} /> Save
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
              {loadingMoreCommunity && <p className="search-status" style={{ marginTop: 8 }}>Loading more…</p>}
              {hasMoreCommunity && !loadingMoreCommunity && (
                <button className="load-more-btn" onClick={loadMoreCommunity}>
                  See more community prices
                </button>
              )}
            </div>
          )}

          {deals.length > 0 && (
            <div className="search-section">
              <div className="search-section-title">This Week's Deals</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {deals.map((deal, i) => (
                  <div
                    key={i}
                    onClick={() => setSelectedDeal(deal)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--card-bg)', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
                  >
                    {deal.clean_image_url
                      ? <img src={deal.clean_image_url} alt={deal.product_name} style={{ width: 60, height: 60, objectFit: 'contain', borderRadius: 8, flexShrink: 0 }} />
                      : <div style={{ width: 60, height: 60, fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{categoryEmoji(deal.product_name)}</div>
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{deal.product_name}</div>
                      {deal.merchant_name && <div style={{ fontSize: 12, color: 'var(--green)', opacity: 0.8, marginBottom: 3 }}>{deal.merchant_name}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {deal.regular_price && <span style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'line-through', marginRight: 4 }}>${Number(deal.regular_price).toFixed(2)}</span>}
                        <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 15 }}>${Number(deal.price).toFixed(2)}</span>
                      </div>
                      {deal.promo_description && <span className="store-deal-promo-badge" style={{ marginTop: 4, display: 'inline-block' }}>{deal.promo_description}</span>}
                    </div>
                  </div>
                ))}
              </div>
              {loadingMoreDeals && <p className="search-status" style={{ marginTop: 8 }}>Loading more…</p>}
              {hasMoreDeals && !loadingMoreDeals && (
                <button className="load-more-btn" onClick={loadMoreDeals}>
                  Load more deals
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {selectedDeal && (
        <div className="store-deal-modal-overlay" onClick={() => setSelectedDeal(null)}>
          <div className="store-deal-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedDeal(null)} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            {selectedDeal.clean_image_url && (
              <img src={selectedDeal.clean_image_url} alt={selectedDeal.product_name} style={{ maxWidth: '180px', maxHeight: '180px', objectFit: 'contain', display: 'block', margin: '0 auto 12px' }} />
            )}
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{selectedDeal.product_name}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
              {selectedDeal.regular_price && (
                <span style={{ fontSize: 14, color: 'var(--text-muted)', textDecoration: 'line-through' }}>${Number(selectedDeal.regular_price).toFixed(2)}</span>
              )}
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)' }}>${Number(selectedDeal.price).toFixed(2)}</span>
            </div>
            {selectedDeal.promo_description && (
              <span className="store-deal-promo-badge" style={{ display: 'inline-block', marginBottom: 8 }}>{selectedDeal.promo_description}</span>
            )}
            {selectedDeal.post_price_text && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>{selectedDeal.post_price_text}</div>
            )}
            {selectedDeal.valid_to && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Valid to: {new Date(selectedDeal.valid_to).toLocaleDateString()}</div>
            )}
            <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 8, fontWeight: 600 }}>{selectedDeal.merchant_name}</div>
          </div>
        </div>
      )}
    </div>
  )
}
