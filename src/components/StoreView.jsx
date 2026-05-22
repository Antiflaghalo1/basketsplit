import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

function namesMatch(a, b) {
  const stop = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'with', 'for', 'oz', 'lb'])
  const words = s => s.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !stop.has(w))
  const wa = words(a), wb = words(b)
  return wa.some(w => wb.includes(w))
}

function categoryEmoji(cat) {
  const c = (cat || '').toLowerCase()
  if (/produce|fruit|vegetable/.test(c)) return '🥬'
  if (/meat|poultry/.test(c)) return '🥩'
  if (/dairy/.test(c)) return '🥛'
  if (/bakery|bread/.test(c)) return '🥖'
  if (/beverage/.test(c)) return '🥤'
  if (/snack/.test(c)) return '🍿'
  if (/frozen/.test(c)) return '🧊'
  if (/pantry|canned/.test(c)) return '🥫'
  return '🛒'
}

async function fetchFlippImage(name) {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}&json=1&page_size=1`)
    if (!res.ok) return null
    const { products } = await res.json()
    const p = products?.[0]
    if (p?.image_url && p?.product_name && namesMatch(name, p.product_name)) return p.image_url
    return null
  } catch {
    return null
  }
}

export default function StoreView({ store, onBack }) {
  const [deals, setDeals] = useState([])
  const [dealImages, setDealImages] = useState({})
  const dealFetchingRef = useRef(new Set())
  const [community, setCommunity] = useState([])
  const [dealsLoading, setDealsLoading] = useState(true)
  const [communityLoading, setCommunityLoading] = useState(true)
  const [showAllDeals, setShowAllDeals] = useState(false)

  useEffect(() => {
    deals.forEach(deal => {
      if (dealFetchingRef.current.has(deal.product_name)) return
      dealFetchingRef.current.add(deal.product_name)
      fetchFlippImage(deal.product_name).then(url => {
        setDealImages(prev => ({ ...prev, [deal.product_name]: url }))
      })
    })
  }, [deals])

  useEffect(() => {
    if (!store) return
    setDealImages({})
    dealFetchingRef.current = new Set()
    loadDeals()
    loadCommunity()
  }, [store?.id])

  async function loadDeals() {
    setDealsLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('flipp_observations')
      .select('product_name, price, sale_type, normalized_category')
      .eq('store_id', store.id)
      .gt('price', 0)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order('price', { ascending: true })
      .limit(30)
    const seen = new Map()
    for (const row of data || []) {
      const key = row.product_name.toLowerCase().trim()
      if (!seen.has(key)) seen.set(key, row)
    }
    setDeals([...seen.values()])
    setDealsLoading(false)
  }

  async function loadCommunity() {
    setCommunityLoading(true)
    const { data: obs } = await supabase
      .from('observations')
      .select('barcode, price, created_at')
      .eq('store_id', store.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (!obs || obs.length === 0) {
      setCommunity([])
      setCommunityLoading(false)
      return
    }

    const upcs = [...new Set(obs.map(o => o.barcode))]
    const { data: products } = await supabase
      .from('products')
      .select('upc, name, image_url, normalized_category, category')
      .in('upc', upcs)

    const productMap = {}
    for (const p of products || []) productMap[String(p.upc)] = p

    const seen = new Set()
    const enriched = []
    for (const o of obs) {
      if (seen.has(o.barcode)) continue
      seen.add(o.barcode)
      const product = productMap[o.barcode]
      if (product) enriched.push({ ...product, price: o.price, created_at: o.created_at })
    }

    setCommunity(enriched)
    setCommunityLoading(false)
  }

  if (!store) return null

  return (
    <div className="store-view">
      <button className="back-btn" onClick={onBack}>← Back</button>

      <div className="store-view-header" style={{ borderLeftColor: store.color }}>
        <div className="store-view-name">{store.name}</div>
        {store.location && <div className="store-view-loc">{store.location}</div>}
      </div>

      <div className="store-view-section">
        <div className="store-view-section-title">This Week's Deals 🏷️</div>
        {dealsLoading ? (
          <p className="store-view-muted">Loading deals…</p>
        ) : deals.length === 0 ? (
          <p className="store-view-muted">No circular data this week</p>
        ) : (
          <>
            <div className="store-deals-list">
              {(showAllDeals ? deals : deals.slice(0, 5)).map((deal, i) => (
                <div key={i} className="store-deal-row">
                  {dealImages[deal.product_name]
                    ? <img src={dealImages[deal.product_name]} alt={deal.product_name} className="recent-thumb" />
                    : <div className="recent-thumb recent-thumb-placeholder" style={{ background: 'var(--green-pale)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
                        {categoryEmoji(deal.normalized_category)}
                      </div>
                  }
                  <div className="store-deal-name">{deal.product_name}</div>
                  <div className="store-deal-right">
                    <span className="store-deal-price">${Number(deal.price).toFixed(2)}</span>
                    {deal.sale_type && <span className="store-deal-type">{deal.sale_type}</span>}
                  </div>
                </div>
              ))}
            </div>
            {deals.length > 5 && (
              <button
                onClick={() => setShowAllDeals(v => !v)}
                style={{ background: 'transparent', border: 'none', color: 'var(--green)', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '8px 0 0' }}
              >
                {showAllDeals ? 'Show less ↑' : `See all ${deals.length} deals →`}
              </button>
            )}
          </>
        )}
      </div>

      <div className="store-view-section">
        <div className="store-view-section-title">Community Prices</div>
        {communityLoading ? (
          <p className="store-view-muted">Loading…</p>
        ) : community.length === 0 ? (
          <p className="store-view-muted">No community scans yet — be the first! 📷</p>
        ) : (
          <div className="recent-list">
            {community.map(item => (
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
                  {item.price != null && (
                    <div className="recent-price">${Number(item.price).toFixed(2)}</div>
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
