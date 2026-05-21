import { useState, useRef, useEffect } from 'react'
import { ITEMS } from './data/stores'
import { optimizeBasket } from './utils/optimizer'
import ScanView from './components/ScanView'
import RecentScansView from './components/RecentScansView'
import AuthView from './components/AuthView'
import ProfileMenu from './components/ProfileMenu'
import { supabase } from './lib/supabase'
import './App.css'

const CATEGORIES = [...new Set(ITEMS.map(i => i.category))]

export default function App() {
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [budget, setBudget] = useState('')
  const [results, setResults] = useState(null)
  const [view, setView] = useState('list')
  const [showNoBudgetBanner, setShowNoBudgetBanner] = useState(false)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const viewStack = useRef([])
  const userRef = useRef(null)

  // Auth state listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      userRef.current = session?.user ?? null
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      userRef.current = session?.user ?? null
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const navTo = (newView) => {
    viewStack.current.push(view)
    window.history.pushState({}, '')
    setView(newView)
  }

  const goBack = () => {
    window.history.back()
  }

  const handlePopState = () => {
    if (!userRef.current) return
    const prev = viewStack.current.pop()
    if (prev !== undefined) setView(prev)
  }

  useEffect(() => {
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!user) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [user])

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
    navTo('results')
    setShowNoBudgetBanner(!budget)
  }

  async function handleSignOut() {
    if (!window.confirm("Sign out of BasketSplit? You'll need to log back in to submit prices.")) return
    await supabase.auth.signOut()
  }

  const budgetNum = parseFloat(budget) || 0
  const overBudget = results && budgetNum > 0 && results.grandTotal > budgetNum

  // User initial for header avatar
  const userInitial = user?.email?.[0]?.toUpperCase()

  // Auth gate
  if (authLoading) return (
    <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</p>
    </div>
  )

  if (!user) return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <span className="logo">🛒</span>
          <div className="header-text">
            <h1>BasketSplit</h1>
            <p className="tagline">IE's smartest grocery optimizer</p>
          </div>
        </div>
      </header>
      <AuthView onBack={() => {}} gated />
    </div>
  )

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <span className="logo">🛒</span>
          <div className="header-text">
            <h1>BasketSplit</h1>
            <p className="tagline">IE's smartest grocery optimizer</p>
          </div>
          <div className="header-actions">
            {view !== 'scan' && view !== 'recent' && (
              <>
                <button className="scan-header-btn" onClick={() => navTo('scan')}>
                  📷 Scan
                </button>
                <button className="scan-header-btn" onClick={() => navTo('recent')}>
                  📦 Recent
                </button>
              </>
            )}
            {user ? (
              <button className="user-avatar-btn" title={user.email} onClick={() => setShowProfileMenu(true)}>
                {userInitial}
              </button>
            ) : (
              <button className="sign-in-btn" onClick={() => navTo('auth')}>
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {view === 'scan' && <ScanView onBack={goBack} user={user} />}
      {view === 'recent' && <RecentScansView onBack={goBack} />}
      {view === 'auth' && <AuthView onBack={goBack} />}

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
          {showNoBudgetBanner && (
            <div className="no-budget-banner">
              <span>Heads up — no budget set. We'll still find you the best prices, just without the over/under tracking. Add one anytime up top. 👆</span>
              <button className="no-budget-dismiss" onClick={() => setShowNoBudgetBanner(false)}>✕</button>
            </div>
          )}
          <div className="results-top">
            <button className="back-btn" onClick={goBack}>← Edit List</button>
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

      {showProfileMenu && user && (
        <ProfileMenu
          user={user}
          onSignOut={handleSignOut}
          onClose={() => setShowProfileMenu(false)}
        />
      )}
    </div>
  )
}
