import { useState } from 'react'
import { ITEMS } from './data/stores'
import { optimizeBasket } from './utils/optimizer'
import './App.css'

const CATEGORIES = [...new Set(ITEMS.map(i => i.category))]

export default function App() {
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [budget, setBudget] = useState('')
  const [results, setResults] = useState(null)
  const [view, setView] = useState('list')

  const toggleItem = (itemId) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      next.has(itemId) ? next.delete(itemId) : next.add(itemId)
      return next
    })
  }

  const optimize = () => {
    if (selectedItems.size === 0) return
    setResults(optimizeBasket([...selectedItems]))
    setView('results')
  }

  const budgetNum = parseFloat(budget) || 0
  const overBudget = results && budgetNum > 0 && results.grandTotal > budgetNum

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <span className="logo">🛒</span>
          <div>
            <h1>BasketSplit</h1>
            <p className="tagline">IE's smartest grocery optimizer</p>
          </div>
        </div>
      </header>

      {view === 'list' && (
        <>
          <div className="budget-bar">
            <label>My Budget</label>
            <div className="budget-wrap">
              <span>$</span>
              <input
                type="number"
                placeholder="0.00"
                value={budget}
                onChange={e => setBudget(e.target.value)}
              />
            </div>
          </div>

          <div className="section-hint">
            {selectedItems.size > 0
              ? `${selectedItems.size} item${selectedItems.size !== 1 ? 's' : ''} on your list`
              : 'Tap items to build your list'}
          </div>

          {CATEGORIES.map(cat => (
            <div key={cat}>
              <div className="cat-label">{cat}</div>
              {ITEMS.filter(i => i.category === cat).map(item => (
                <div
                  key={item.id}
                  className={`item-row ${selectedItems.has(item.id) ? 'selected' : ''}`}
                  onClick={() => toggleItem(item.id)}
                >
                  <div className="item-name">{item.name}</div>
                  <div className="item-low">from ${Math.min(...Object.values(item.prices)).toFixed(2)}</div>
                  <div className="item-check">{selectedItems.has(item.id) ? '✓' : '+'}</div>
                </div>
              ))}
            </div>
          ))}

          <div className="footer-cta">
            <button className="cta-btn" onClick={optimize} disabled={selectedItems.size === 0}>
              Find Best Prices →
            </button>
          </div>
        </>
      )}

      {view === 'results' && results && (
        <>
          <div className="results-top">
            <button className="back-btn" onClick={() => setView('list')}>← Edit List</button>
            <div className={`total-card ${overBudget ? 'over' : ''}`}>
              <div className="total-label">Total Across All Stores</div>
              <div className="total-amount">${results.grandTotal.toFixed(2)}</div>
              {budgetNum > 0 && (
                <div className="budget-tag">
                  {overBudget
                    ? `$${(results.grandTotal - budgetNum).toFixed(2)} over budget`
                    : `$${(budgetNum - results.grandTotal).toFixed(2)} under budget ✓`}
                </div>
              )}
            </div>
            <div className="stops-label">
              {results.storeBreakdown.length} stop{results.storeBreakdown.length !== 1 ? 's' : ''}
            </div>
          </div>

          {results.storeBreakdown.map(({ store, items, subtotal }) => (
            <div key={store.id} className="store-card" style={{ '--accent': store.color }}>
              <div className="store-head">
                <div>
                  <div className="store-name">{store.name}</div>
                  <div className="store-loc">📍 {store.location}</div>
                </div>
                <div className="store-sub">${subtotal.toFixed(2)}</div>
              </div>
              <div className="store-items">
                {items.map(item => (
                  <div key={item.id} className="result-row">
                    <span>{item.name}</span>
                    <span className="result-price">${item.bestPrice.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <p className="disclaimer">💡 Prices are community-estimated. Verify in store.</p>
        </>
      )}
    </div>
  )
}