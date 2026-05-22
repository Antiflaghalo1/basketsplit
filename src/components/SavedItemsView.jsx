import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SavedItemsView({
  savedItems,
  savedUpcs,
  selectedSavedItems,
  setSelectedSavedItems,
  onOptimize,
  onBrowse,
}) {
  const [bestPrices, setBestPrices] = useState({})
  const [pricesLoading, setPricesLoading] = useState(false)

  useEffect(() => {
    if (savedUpcs.size === 0) return
    setPricesLoading(true)
    supabase
      .from('observations')
      .select('barcode, price')
      .in('barcode', [...savedUpcs])
      .gt('price', 0)
      .lte('price', 500)
      .then(({ data: obs }) => {
        const mins = {}
        for (const o of obs || []) {
          if (!(o.barcode in mins) || o.price < mins[o.barcode]) {
            mins[o.barcode] = o.price
          }
        }
        setBestPrices(mins)
        setPricesLoading(false)
      })
  }, [])

  function toggleItem(upc) {
    setSelectedSavedItems(prev => {
      const next = new Set(prev)
      next.has(upc) ? next.delete(upc) : next.add(upc)
      return next
    })
  }

  if (savedItems.length === 0) {
    return (
      <div className="saved-items-view">
        <div className="recent-empty">
          <p className="recent-empty-emoji">🐿️</p>
          <p className="recent-empty-title">Nothing saved yet</p>
          <p className="recent-empty-sub">Browse Categories to add items</p>
          <button className="cta-btn" style={{ marginTop: 20 }} onClick={onBrowse}>
            Browse Categories →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="saved-items-view">
      <div className="section-hint">
        {selectedSavedItems.size > 0
          ? `${selectedSavedItems.size} item${selectedSavedItems.size !== 1 ? 's' : ''} on your list`
          : 'Tap items to build your list'}
      </div>

      {savedItems.map(item => {
        const upc = String(item.upc)
        const isSelected = selectedSavedItems.has(upc)
        const minPrice = bestPrices[upc]
        return (
          <div
            key={upc}
            className={`item-row${isSelected ? ' selected' : ''}`}
            onClick={() => toggleItem(upc)}
          >
            {item.image_url ? (
              <img src={item.image_url} alt={item.name} className="saved-item-thumb" />
            ) : (
              <div className="saved-item-thumb saved-item-thumb-placeholder">🛒</div>
            )}
            <div className="item-name">
              {item.name}
              {item.normalized_category && (
                <div className="saved-item-cat">{item.normalized_category}</div>
              )}
            </div>
            <div className="item-low">
              {pricesLoading
                ? '…'
                : minPrice != null
                  ? `from $${minPrice.toFixed(2)}`
                  : 'No prices yet — scan it! 📷'}
            </div>
            <div className="item-check">{isSelected ? '✓' : '+'}</div>
          </div>
        )
      })}

      <button
        className={`cta-floating${selectedSavedItems.size > 0 ? ' cta-floating-visible' : ''}`}
        onClick={onOptimize}
      >
        Find Best Prices →
      </button>
    </div>
  )
}
