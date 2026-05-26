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
import SearchView from './components/SearchView'
import StoreView from './components/StoreView'
import EditProfileView from './components/EditProfileView'
import TutorialOverlay from './components/TutorialOverlay'
import AIAssistantView from './components/AIAssistantView'
import ShoppingModeView from './components/ShoppingModeView'
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
  const [selectedStore, setSelectedStore] = useState(null)
  const [aiContext, setAiContext] = useState(null)
  const [shoppingStore, setShoppingStore] = useState(null)
  const [shoppingItems, setShoppingItems] = useState([])
  const [savedItemsCount, setSavedItemsCount] = useState(0)
  const [queueToast, setQueueToast] = useState(0)
  const [queueCount, setQueueCount] = useState(0)
  const viewStack = useRef([])
  const userRef = useRef(null)

  function getQueueCount() {
    try {
      return JSON.parse(localStorage.getItem('squrry_submission_queue') || '[]').length
    } catch { return 0 }
  }

  async function flushQueue() {
    let submitted = 0

    try {
      const queue = JSON.parse(localStorage.getItem('squrry_submission_queue') || '[]')
      if (queue.length > 0) {
        const remaining = []
        for (const item of queue) {
          const { queued_at, ...obs } = item
          try {
            const { error } = await supabase.from('observations').insert(obs)
            if (error) remaining.push(item)
            else submitted++
          } catch { remaining.push(item) }
        }
        localStorage.setItem('squrry_submission_queue', JSON.stringify(remaining))
      }
    } catch {}

    try {
      const pq = JSON.parse(localStorage.getItem('squrry_product_queue') || '[]')
      if (pq.length > 0) {
        const remainingP = []
        for (const item of pq) {
          try {
            await supabase.from('products').upsert(item)
          } catch { remainingP.push(item) }
        }
        localStorage.setItem('squrry_product_queue', JSON.stringify(remainingP))
      }
    } catch {}

    setQueueCount(getQueueCount())
    return submitted
  }

  useEffect(() => {
    const handle = async () => {
      const count = await flushQueue()
      if (count > 0) setQueueToast(count)
    }
    handle()
    window.addEventListener('online', handle)
    window.addEventListener('focus', handle)
    return () => {
      window.removeEventListener('online', handle)
      window.removeEventListener('focus', handle)
    }
  }, [])

  useEffect(() => {
    if (queueToast === 0) return
    const t = setTimeout(() => setQueueToast(0), 3000)
    return () => clearTimeout(t)
  }, [queueToast])

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
    if (!user?.id) {
      setSavedItemsCount(0)
      return
    }
    supabase
      .from('saved_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .then(({ count }) => setSavedItemsCount(count || 0))
  }, [user?.id, view])

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

  async function buildAIContext(userId) {
    const [profileRes, savedRes, storesRes] = await Promise.all([
      supabase.from('profiles').select('first_name, budget').eq('id', userId).single(),
      supabase.from('saved_items').select('upc, name, normalized_category').eq('user_id', userId),
      getAllStores()
    ])

    const savedItems = savedRes.data || []
    const upcs = savedItems.map(i => i.upc).filter(Boolean)

    let pricesData = []
    if (upcs.length > 0) {
      const { data } = await supabase
        .from('observations')
        .select('barcode, store_id, price')
        .in('barcode', upcs)
        .eq('voided', false)
        .gt('price', 0)
        .lt('price', 500)
      pricesData = data || []
    }

    const today = new Date().toISOString().split('T')[0]
    const { data: flippData } = await supabase
      .from('flipp_observations')
      .select('product_name, store_id, price, valid_to')
      .gt('price', 0)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order('price', { ascending: true })
      .limit(50)

    const priceMap = {}
    for (const obs of pricesData) {
      if (!priceMap[obs.barcode]) priceMap[obs.barcode] = []
      const store = storesRes.find(s => s.id === obs.store_id)
      priceMap[obs.barcode].push({
        storeName: store?.name || obs.store_id,
        price: parseFloat(obs.price).toFixed(2)
      })
    }

    const enrichedItems = savedItems.map(item => ({
      name: item.name,
      normalized_category: item.normalized_category,
      prices: priceMap[item.upc] || []
    }))

    const weeklyDeals = (flippData || []).map(d => {
      const store = storesRes.find(s => s.id === d.store_id)
      return {
        productName: d.product_name,
        storeName: store?.name || d.store_id,
        price: parseFloat(d.price).toFixed(2)
      }
    })

    return {
      userName: profileRes.data?.first_name || 'there',
      budget: profileRes.data?.budget || 0,
      savedItems: enrichedItems,
      weeklyDeals,
      stores: storesRes
    }
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
    const bustUrl = publicUrl + '?t=' + Date.now()
    await supabase.from('profiles').update({ avatar_url: bustUrl }).eq('id', user.id)
    setAvatarUrl(bustUrl)
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

  function handleRemoveItem(upc) {
    setSavedItems(prev => prev.filter(i => String(i.upc) !== upc))
    setSavedUpcs(prev => { const next = new Set(prev); next.delete(upc); return next })
    setSelectedSavedItems(prev => { const next = new Set(prev); next.delete(upc); return next })
  }

  async function handleCartClick() {
    if (!user?.id) {
      navTo('auth')
      return
    }
    const { data: savedItemsData } = await supabase
      .from('saved_items')
      .select('upc')
      .eq('user_id', user.id)

    if (!savedItemsData || savedItemsData.length === 0) {
      navTo('saved')
      return
    }

    const upcs = savedItemsData.map(s => String(s.upc))
    const stores = await getAllStores()
    const optimizerResults = await optimizeFromSupabase(upcs, stores)
    setResults(optimizerResults)
    setResultSource('supabase')
    navTo('results')
    setShowNoBudgetBanner(!budget)
  }

  async function handleRemoveFromTrip(upc) {
    if (!user?.id) return
    await supabase.from('saved_items').delete()
      .eq('user_id', user.id)
      .eq('upc', upc)
    handleRemoveItem(upc)
    setSavedItemsCount(prev => Math.max(0, prev - 1))
    const remainingUpcs = results.storeBreakdown
      .flatMap(b => b.items.map(i => i.id))
      .filter(id => id !== upc)
    if (remainingUpcs.length === 0) {
      setResults(null)
      navTo('saved')
      return
    }
    const stores = await getAllStores()
    const newResults = await optimizeFromSupabase(remainingUpcs, stores)
    setResults(newResults)
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

  const worstCaseTotal = resultSource === 'saved' && results?.priceMap
    ? Array.from(selectedSavedItems).reduce((sum, upc) => {
        const storePrices = results.priceMap[String(upc)]
        if (!storePrices || Object.keys(storePrices).length === 0) return sum
        return sum + Math.max(...Object.values(storePrices))
      }, 0)
    : 0
  const savedAmount = worstCaseTotal - (results?.grandTotal ?? 0)

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
          <div className="logo">🛒</div>
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
            <div className="logo">🛒</div>
            BasketSplit
          </div>
          <div className="topbar-actions">
            {queueCount > 0 && (
              <div className="queue-badge" title="Pending uploads">↑ {queueCount}</div>
            )}
            <button className="topbar-search-btn" onClick={() => navTo('search')}>
              <Search size={20} />
            </button>
            <div className="topbar-cart-wrap">
              <button className="topbar-cart-btn" onClick={handleCartClick}>
                <ShoppingCart size={20} />
              </button>
              {savedItemsCount > 0 && (
                <span className="topbar-cart-badge">{savedItemsCount}</span>
              )}
            </div>
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
          onStoreSelect={(store) => { setSelectedStore(store); navTo('store') }}
        />
      )}

      {view === 'search' && <SearchView onBack={goBack} />}
      {view === 'store' && <StoreView store={selectedStore} onBack={goBack} />}
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
            <button className="back-btn" onClick={() => navTo('saved')}>← Edit List</button>
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

          {resultSource === 'saved' && (savedAmount > 0 || results.unmatched?.length > 0) && (
            <div className="savings-summary-card">
              {savedAmount > 0 && (
                <>
                  <div className="savings-amount">🎉 You saved ${savedAmount.toFixed(2)}</div>
                  <div className="savings-sub">vs buying everything at one store</div>
                </>
              )}
              {results.unmatched?.length > 0 && (
                <p className="savings-unmatched">
                  {results.unmatched.length} item{results.unmatched.length !== 1 ? 's' : ''} had no price data yet — scan them to unlock more savings!
                </p>
              )}
            </div>
          )}

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
                    <span className="result-price">
                      ${item.bestPrice.toFixed(2)}
                      {results.flippSaleItems?.has(`${item.id}:${store.id}`) && (
                        <span className="flipp-sale-pill">🏷️ On sale</span>
                      )}
                    </span>
                    <button
                      onClick={() => handleRemoveFromTrip(item.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)',
                        fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                      aria-label="Remove item"
                    >✕</button>
                  </div>
                ))}
              </div>
              <div style={{ padding: '10px 14px 14px' }}>
                <button
                  className="cta-btn"
                  onClick={() => {
                    setShoppingStore(store)
                    setShoppingItems(items.map(item => ({ ...item, prices: { [store.id]: item.bestPrice } })))
                    navTo('shopping')
                  }}
                >
                  Start Shopping at {store.name}
                </button>
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
          onItemRemoved={handleRemoveItem}
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
          userId={user?.id}
          onItemRemoved={handleRemoveItem}
        />
      )}
      {view === 'profile' && (
        <ProfileView user={user} firstName={firstName} lastName={lastName} avatarUrl={avatarUrl} onAvatarUpload={handleAvatarUpload} onSignOut={handleSignOut} onMyScans={() => navTo('recent')} onEditProfile={() => navTo('editprofile')} />
      )}
      {view === 'editprofile' && (
        <EditProfileView user={user} firstName={firstName} lastName={lastName} onBack={goBack} onSave={(f, l) => { setFirstName(f); setLastName(l) }} />
      )}
      {view === 'budget' && (
        <BudgetView user={user} budget={budget} onBack={goBack} onBudgetSave={handleBudgetSave} />
      )}
      {view === 'ai' && (
        <AIAssistantView aiContext={aiContext} onBack={goBack} user={user} />
      )}
      {view === 'shopping' && (
        <ShoppingModeView store={shoppingStore} items={shoppingItems} user={user} onBack={goBack} />
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
        avatarUrl={avatarUrl}
        firstName={firstName}
        lastName={lastName}
        userEmail={user?.email}
        onBudgetNav={() => { setShowDrawer(false); navTo('budget') }}
        onLegal={(type) => { setShowDrawer(false); navTo(type) }}
        onMyScans={() => { setShowDrawer(false); navTo('recent') }}
        onHelp={() => { setShowDrawer(false); setShowTutorial(true) }}
        onSignOut={() => { setShowDrawer(false); handleSignOut() }}
        onHome={() => { setShowDrawer(false); navTo('home') }}
        onAI={() => { setShowDrawer(false); navTo('ai'); buildAIContext(user.id).then(ctx => setAiContext(ctx)) }}
      />

      {showTutorial && (
        <TutorialOverlay onComplete={() => {
          localStorage.setItem('bs_tutorial_seen', '1')
          setShowTutorial(false)
        }} />
      )}

      {queueToast > 0 && (
        <div className="queue-flush-toast">
          ✓ {queueToast} scan{queueToast !== 1 ? 's' : ''} submitted
        </div>
      )}

      {view !== 'scan' && view !== 'auth' && view !== 'tos' && view !== 'privacy' && view !== 'shopping' && (
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
