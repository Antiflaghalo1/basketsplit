import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { removeSavedItem } from '../data/savedItems'

function SwipableRow({ item, isSelected, minPrice, pricesLoading, onToggle, onRemove }) {
  const rowRef = useRef(null)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const deltaRef = useRef(0)
  const longPressRef = useRef(null)

  function handleTouchStart(e) {
    startXRef.current = e.touches[0].clientX
    startYRef.current = e.touches[0].clientY
    deltaRef.current = 0
    if (rowRef.current) rowRef.current.style.transition = 'none'
    longPressRef.current = setTimeout(() => {
      const confirmed = window.confirm(`Remove ${item.name} from saved?`)
      if (confirmed) onRemove()
    }, 600)
  }

  function handleTouchMove(e) {
    const dx = e.touches[0].clientX - startXRef.current
    const dy = e.touches[0].clientY - startYRef.current
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
    if (dx < -10) {
      const clamped = Math.max(dx, -80)
      deltaRef.current = clamped
      if (rowRef.current) rowRef.current.style.transform = `translateX(${clamped}px)`
    }
  }

  function handleTouchEnd() {
    clearTimeout(longPressRef.current)
    longPressRef.current = null
    if (rowRef.current) rowRef.current.style.transition = 'transform 0.2s ease'
    if (deltaRef.current < -60) {
      const confirmed = window.confirm(`Remove ${item.name} from saved?`)
      if (confirmed) {
        onRemove()
      } else {
        if (rowRef.current) rowRef.current.style.transform = 'translateX(0)'
      }
    } else {
      if (rowRef.current) rowRef.current.style.transform = 'translateX(0)'
    }
  }

  return (
    <div className="saved-row-wrap">
      <div className="saved-delete-reveal">Remove</div>
      <div
        ref={rowRef}
        className={`item-row${isSelected ? ' selected' : ''}`}
        onClick={onToggle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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
    </div>
  )
}

export default function SavedItemsView({
  savedItems,
  savedUpcs,
  selectedSavedItems,
  setSelectedSavedItems,
  onOptimize,
  onBrowse,
  userId,
  onItemRemoved,
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

  async function handleRemove(item) {
    await removeSavedItem(userId, item.upc)
    onItemRemoved(String(item.upc))
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
        return (
          <SwipableRow
            key={upc}
            item={item}
            isSelected={selectedSavedItems.has(upc)}
            minPrice={bestPrices[upc]}
            pricesLoading={pricesLoading}
            onToggle={() => toggleItem(upc)}
            onRemove={() => handleRemove(item)}
          />
        )
      })}

      <p style={{ textAlign: 'center', fontSize: 12, fontStyle: 'italic', color: 'var(--text-muted)', marginTop: 8 }}>
        Swipe left or hold to remove items
      </p>

      <button
        className={`cta-floating${selectedSavedItems.size > 0 ? ' cta-floating-visible' : ''}`}
        onClick={onOptimize}
      >
        Find Best Prices →
      </button>
    </div>
  )
}
