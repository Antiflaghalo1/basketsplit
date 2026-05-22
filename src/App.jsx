import { useState, useRef, useEffect } from 'react'
import { Menu, Search, ShoppingCart, Home, LayoutGrid, ScanLine, Heart, User } from 'lucide-react'
import { ITEMS } from './data/stores'
import { optimizeBasket } from './utils/optimizer'
import { optimizeFromSupabase } from './utils/optimizerService'
import ScanView from './components/ScanView'
import RecentScansView from './components/RecentScansView'
import AuthView from './components/AuthView'
import LegalView from './components/LegalView'
import ProfileMenu from './components/ProfileMenu'
import ProfileView from './components/ProfileView'
import HamburgerDrawer from './components/HamburgerDrawer'
import BudgetView from './components/BudgetView'
import CategoriesView from './components/CategoriesView'
import SavedItemsView from './components/SavedItemsView'
import HomeView from './components/HomeView'
import TutorialOverlay from './components/TutorialOverlay'
import { supabase } from './lib/supabase'
import { getSavedItems, saveItem } from './data/savedItems'
import { getAllStores } from './data/storeService'
import './App.css'

const CATEGORIES = [...new Set(ITEMS.map(i => i.category))]

export default function App() {
  const [stores, setStores] = useState([])
  const [savedItems, setSavedItems] = useState([])
  const [savedUpcs, setSavedUpcs] = useState(new Set())
  const [selectedSavedItems, setSelectedSavedItems] = useState(new Set())
  const [resultSource, setResultSource] = useState('legacy')
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [budget, setBudget] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [results, setResults] = useState(null)
  const [view, setView] = useState('home')
  const [showNoBudgetBanner, setShowNoBudgetBanner] = useState(false)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [showTutorial, setShowTutorial] = useState(!localStorage.getItem('bs_tutorial_seen'))
  const viewStack = useRef([])
  const userRef = useRef(null)

  // Auth state listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      userRef.current = session?.user ?? null
      setUser(session?.user ?? null)
      setAuthLoading(false)
      if (session?.user) {
        supabase.from('profiles').select('budget, first_name, last_name, avatar_url').eq('id', session.user.id).single()
          .then(({ data }) => {
            if (data?.budget != null) setBudget(data.budget)
            if (data?.first_name) setFirstName(data.first_name)
            if (data?.last_name) setLastName(data.last_name)
            if (data?.avatar_url) setAvatarUrl(data.avatar_url)
          })
        getSavedItems(session.user.id).then(items => {
          setSavedItems(items)
          setSavedUpcs(new Set(items.map(i => String(i.upc))))
        })
        getAllStores().then(setStores)
      }
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
    setResultSource('legacy')
    navTo('results')
    setShowNoBudgetBanner(!budget)
  }

  async function handleAvatarUpload(file) {
    const { error: uploadError } = await supabase.storage.from('avatars').upload(
      user.id + '.jpg', file, { upsert: true, contentType: file.type }
    )
    if (uploadError) throw uploadError
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(user.id + '.jpg')
    await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id)
    setAvatarUrl(publicUrl)
  }

  async function handleBudgetSave(newValue) {
    setBudget(newValue)
    await supabase.from('profiles').update({ budget: newValue }).eq('id', user.id)
  }

  function handleSaveItem(product) {
    const upc = String(product.upc)
    setSavedItems(prev => [...prev, product])
    setSavedUpcs(prev => new Set([...prev, upc]))
  }

  async function handleOptimizeSaved() {
    const res = await optimizeFromSupabase(Array.from(selectedSavedItems), stores)
    setResults(res)
    setResultSource('saved')
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
      {(view === 'tos' || view === 'privacy')
        ? <LegalView type={view} onBack={() => setView('list')} />
        : <AuthView onBack={() => {}} gated onLegal={(type) => setView(type)} />
      }
    </div>
  )

  return (
    <div className="app">
      <header className="header">
        <div className="topbar-inner">
          <button className="topbar-menu-btn" onClick={() => setShowDrawer(true)}>
            <Menu size={22} />
          </button>
          <div className="topbar-wordmark">
            BasketSplit <span className="topbar-wordmark-emoji">🛒</span>
          </div>
          <div className="topbar-actions">
            <button className="topbar-search-btn" onClick={() => console.log('search')}>
              <Search size={20} />
            </button>
            <div className="topbar-cart-wrap">
              <button className="topbar-cart-btn" onClick={() => navTo('list')}>
                <ShoppingCart size={20} />
              </button>
              {selectedItems.size > 0 && (
                <span className="topbar-cart-badge">{selectedItems.size}</span>
              )}
            </div>
            <button className="user-avatar-btn" onClick={() => navTo('profile')}>
              {avatarUrl
                ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : userInitial
              }
            </button>
          </div>
        </div>
      </header>

      {view === 'home' && (
        <HomeView
          user={user}
          firstName={firstName}
          budget={budget}
          onBudgetNav={() => navTo('budget')}
          onSeeAll={() => navTo('recent')}
        />
      )}

      {view === 'scan' && <ScanView onBack={goBack} user={user} />}
      {view === 'recent' && <RecentScansView onBack={goBack} userId={user?.id} />}
      {view === 'auth' && <AuthView onBack={goBack} onLegal={(type) => navTo(type)} />}
      {(view === 'tos' || view === 'privacy') && <LegalView type={view} onBack={goBack} />}

      {view === 'list' && (
        <>
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

          <button
            className={`cta-floating${selectedItems.size > 0 ? ' cta-floating-visible' : ''}`}
            onClick={optimize}
          >
            Find Best Prices →
          </button>
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
          {resultSource === 'saved' && results.unmatched?.length > 0 && (
            <div className="no-budget-banner">
              <span>📷 {results.unmatched.length} item{results.unmatched.length !== 1 ? 's' : ''} had no price data yet — scan them to add prices!</span>
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

      {view === 'categories' && (
        <CategoriesView
          onBack={goBack}
          userId={user?.id}
          savedUpcs={savedUpcs}
          onItemSaved={handleSaveItem}
        />
      )}
      {view === 'saved' && (
        <SavedItemsView
          savedItems={savedItems}
          savedUpcs={savedUpcs}
          selectedSavedItems={selectedSavedItems}
          setSelectedSavedItems={setSelectedSavedItems}
          onOptimize={handleOptimizeSaved}
          onBrowse={() => navTo('categories')}
        />
      )}
      {view === 'profile' && (
        <ProfileView user={user} firstName={firstName} lastName={lastName} avatarUrl={avatarUrl} onAvatarUpload={handleAvatarUpload} onSignOut={handleSignOut} onMyScans={() => navTo('recent')} />
      )}
      {view === 'budget' && (
        <BudgetView user={user} budget={budget} onBack={goBack} onBudgetSave={handleBudgetSave} />
      )}

      {showProfileMenu && user && (
        <ProfileMenu
          user={user}
          firstName={firstName}
          lastName={lastName}
          onSignOut={handleSignOut}
          onClose={() => setShowProfileMenu(false)}
        />
      )}

      <HamburgerDrawer
        isOpen={showDrawer}
        onClose={() => setShowDrawer(false)}
        budget={budget}
        onBudgetNav={() => { setShowDrawer(false); navTo('budget') }}
        onLegal={(type) => { setShowDrawer(false); navTo(type) }}
        onMyScans={() => { setShowDrawer(false); navTo('recent') }}
        onHelp={() => { setShowDrawer(false); setShowTutorial(true) }}
        onSignOut={() => { setShowDrawer(false); handleSignOut() }}
      />

      {showTutorial && (
        <TutorialOverlay onComplete={() => {
          localStorage.setItem('bs_tutorial_seen', '1')
          setShowTutorial(false)
        }} />
      )}

      {view !== 'scan' && view !== 'auth' && view !== 'tos' && view !== 'privacy' && (
        <nav className="bottom-nav">
          <button className={`bottom-nav-tab${view === 'home' ? ' active' : ''}`} onClick={() => navTo('home')}>
            <Home size={22} />
            <span className="bottom-nav-label">Home</span>
          </button>
          <button className={`bottom-nav-tab${view === 'categories' ? ' active' : ''}`} onClick={() => navTo('categories')}>
            <LayoutGrid size={22} />
            <span className="bottom-nav-label">Categories</span>
          </button>
          <button className="bottom-nav-scan" onClick={() => navTo('scan')}>
            <ScanLine size={26} />
          </button>
          <button className={`bottom-nav-tab${view === 'saved' ? ' active' : ''}`} onClick={() => navTo('saved')}>
            <Heart size={22} />
            <span className="bottom-nav-label">Saved</span>
          </button>
          <button className={`bottom-nav-tab${view === 'profile' ? ' active' : ''}`} onClick={() => navTo('profile')}>
            <User size={22} />
            <span className="bottom-nav-label">Profile</span>
          </button>
        </nav>
      )}
    </div>
  )
}
