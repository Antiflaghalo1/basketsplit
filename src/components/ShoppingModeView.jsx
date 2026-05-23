import { useState } from 'react'
import { addObservation } from '../data/observations'

const SCREENS = { FORK: 'FORK', DIRECTIONS: 'DIRECTIONS', CHECKLIST: 'CHECKLIST', RECEIPT: 'RECEIPT', RECAP: 'RECAP' }

export default function ShoppingModeView({ store, items, onBack, user }) {
  const [screen, setScreen] = useState(SCREENS.FORK)
  const [receiptImage, setReceiptImage] = useState(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [itemStates, setItemStates] = useState(() =>
    Object.fromEntries((items || []).map(item => [
      item.id,
      { checked: false, verifyState: null, editingPrice: false, draftPrice: '', updatedPrice: null },
    ]))
  )

  function toggleChecked(id) {
    setItemStates(prev => {
      const s = prev[id]
      if (s.checked) {
        return { ...prev, [id]: { ...s, checked: false, verifyState: null, editingPrice: false, draftPrice: '' } }
      }
      return { ...prev, [id]: { ...s, checked: true } }
    })
  }

  function writeObservation(item, price) {
    addObservation({
      barcode: item.upc ?? item.id,
      productName: item.name,
      storeId: store?.id,
      price,
      hasPhoto: false,
    }, user?.id)
  }

  function confirmPrice(id) {
    const item = (items || []).find(i => i.id === id)
    const price = item?.prices?.[store?.id]
    if (item && price != null) writeObservation(item, price)
    setItemStates(prev => ({ ...prev, [id]: { ...prev[id], verifyState: 'confirmed', editingPrice: false } }))
  }

  function startEditPrice(id, currentPrice) {
    setItemStates(prev => ({
      ...prev,
      [id]: { ...prev[id], editingPrice: true, draftPrice: currentPrice != null ? String(currentPrice) : '' },
    }))
  }

  function saveUpdatedPrice(id) {
    const parsed = parseFloat(itemStates[id].draftPrice)
    if (isNaN(parsed) || parsed < 0) return
    const item = (items || []).find(i => i.id === id)
    if (item) writeObservation(item, parsed)
    setItemStates(prev => ({
      ...prev,
      [id]: { ...prev[id], verifyState: 'updated', updatedPrice: parsed, editingPrice: false },
    }))
  }

  if (screen === SCREENS.DIRECTIONS) {
    const mapQuery = encodeURIComponent([store?.name, store?.location].filter(Boolean).join(', '))
    return (
      <div style={{ padding: '18px 18px 40px' }}>
        <button className="back-btn" onClick={() => setScreen(SCREENS.FORK)}>← Back</button>

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--green)', marginBottom: 4 }}>
            {store?.name}
          </div>
          {store?.location && (
            <div style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 600 }}>
              {store.location}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
          <a
            href={`https://maps.apple.com/?q=${mapQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: 'var(--card-bg)',
              border: '1.5px solid var(--border)',
              borderRadius: 12,
              padding: '14px 20px',
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--text)',
              textDecoration: 'none',
              boxShadow: '0 1px 4px rgba(0,0,0,.06)',
            }}
          >
            <span style={{ fontSize: 20 }}>🍎</span> Open in Apple Maps
          </a>
          <a
            href={`https://maps.google.com/?q=${mapQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: 'var(--card-bg)',
              border: '1.5px solid var(--border)',
              borderRadius: 12,
              padding: '14px 20px',
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--text)',
              textDecoration: 'none',
              boxShadow: '0 1px 4px rgba(0,0,0,.06)',
            }}
          >
            <span style={{ fontSize: 20 }}>🗺️</span> Open in Google Maps
          </a>
        </div>

        <button
          className="cta-btn"
          onClick={() => setScreen(SCREENS.CHECKLIST)}
        >
          I'm Here — Start Shopping
        </button>
      </div>
    )
  }

  if (screen === SCREENS.CHECKLIST) {
    const allItems = items || []
    const storeId = store?.id
    const checkedCount = allItems.filter(item => itemStates[item.id]?.checked).length
    const allChecked = allItems.length > 0 && checkedCount === allItems.length

    return (
      <div style={{ padding: '18px 18px 100px' }}>
        <button className="back-btn" onClick={() => setScreen(SCREENS.DIRECTIONS)}>← Back</button>

        {/* Header + progress */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--green)', marginBottom: 12 }}>
            {store?.name} — Shopping
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: allItems.length ? `${(checkedCount / allItems.length) * 100}%` : '0%',
                background: 'var(--green)',
                borderRadius: 4,
                transition: 'width .25s ease',
              }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {checkedCount} of {allItems.length} grabbed
            </span>
          </div>
        </div>

        {/* Item list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {allItems.map(item => {
            const s = itemStates[item.id] || {}
            const basePrice = item.prices?.[storeId]
            const displayPrice = s.updatedPrice ?? basePrice

            return (
              <div
                key={item.id}
                style={{
                  background: s.checked ? 'var(--green-pale)' : 'white',
                  border: `1.5px solid ${s.checked ? 'var(--green)' : 'var(--border)'}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  transition: 'background .15s, border-color .15s',
                }}
              >
                {/* Main row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => toggleChecked(item.id)}
                    style={{
                      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${s.checked ? 'var(--green)' : 'var(--border)'}`,
                      background: s.checked ? 'var(--green)' : 'white',
                      color: 'white', fontSize: 14, fontWeight: 900,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all .12s',
                    }}
                  >
                    {s.checked ? '✓' : ''}
                  </button>
                  <span style={{
                    flex: 1, fontSize: 15, fontWeight: 500,
                    color: 'var(--text)',
                    textDecoration: s.verifyState ? 'none' : 'none',
                  }}>
                    {item.name}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--green-dark)' }}>
                    {displayPrice != null ? `$${Number(displayPrice).toFixed(2)}` : '—'}
                  </span>
                </div>

                {/* Expansion */}
                {s.checked && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    {s.verifyState === 'confirmed' && (
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>✓ Verified</span>
                    )}
                    {s.verifyState === 'updated' && (
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)' }}>
                        ⚠ Price updated to ${Number(s.updatedPrice).toFixed(2)}
                      </span>
                    )}
                    {s.verifyState === null && !s.editingPrice && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, marginRight: 4 }}>
                          Still {basePrice != null ? `$${Number(basePrice).toFixed(2)}` : 'this price'}?
                        </span>
                        <button
                          onClick={() => confirmPrice(item.id)}
                          style={{
                            background: 'var(--green)', color: 'white', border: 'none',
                            borderRadius: 8, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => startEditPrice(item.id, basePrice)}
                          style={{
                            background: 'white', color: 'var(--text-muted)',
                            border: '1.5px solid var(--border)',
                            borderRadius: 8, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                          }}
                        >
                          Update Price
                        </button>
                      </div>
                    )}
                    {s.editingPrice && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>$</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={s.draftPrice}
                          onChange={e => setItemStates(prev => ({
                            ...prev, [item.id]: { ...prev[item.id], draftPrice: e.target.value },
                          }))}
                          style={{
                            width: 90, border: '1.5px solid var(--green)', borderRadius: 8,
                            padding: '6px 10px', fontSize: 16, fontWeight: 700,
                            color: 'var(--green)', outline: 'none', background: 'white',
                          }}
                          autoFocus
                        />
                        <button
                          onClick={() => saveUpdatedPrice(item.id)}
                          style={{
                            background: 'var(--green)', color: 'white', border: 'none',
                            borderRadius: 8, padding: '5px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                          }}
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Done CTA — only when all checked */}
        {allChecked && (
          <button className="cta-btn" onClick={() => setScreen(SCREENS.RECEIPT)}>
            Done — Upload Receipt
          </button>
        )}
      </div>
    )
  }

  if (screen === SCREENS.RECEIPT) {
    function handleFile(e) {
      const file = e.target.files?.[0]
      if (!file) return
      const url = URL.createObjectURL(file)
      setReceiptImage(url)
    }

    return (
      <div style={{ padding: '18px 18px 40px' }}>
        <button className="back-btn" onClick={() => setScreen(SCREENS.CHECKLIST)}>← Back</button>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--green)', marginBottom: 4 }}>
            Upload Receipt
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Snap or upload your receipt to track what you actually spent.
          </div>
        </div>

        {receiptImage ? (
          <div style={{ marginBottom: 24 }}>
            <img
              src={receiptImage}
              alt="Receipt preview"
              style={{
                width: '100%', borderRadius: 12, border: '1.5px solid var(--border)',
                display: 'block', maxHeight: 420, objectFit: 'contain', background: '#f9f9f9',
              }}
            />
            <button
              onClick={() => setReceiptImage(null)}
              style={{
                marginTop: 10, background: 'none', border: 'none',
                color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', padding: 0,
              }}
            >
              ✕ Remove and re-upload
            </button>
          </div>
        ) : (
          <label style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: '36px 20px', marginBottom: 24,
            border: '2px dashed var(--green)', borderRadius: 16,
            background: 'var(--green-pale)', cursor: 'pointer',
          }}>
            <span style={{ fontSize: 40 }}>🧾</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>
              Tap to add receipt
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Camera or photo roll
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFile}
              style={{ display: 'none' }}
            />
          </label>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            className="cta-btn"
            disabled={!receiptImage}
            onClick={() => setScreen(SCREENS.RECAP)}
          >
            Continue
          </button>
          <button
            onClick={() => setScreen(SCREENS.RECAP)}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: 15, fontWeight: 700, cursor: 'pointer', padding: '10px 0',
            }}
          >
            Skip
          </button>
        </div>
      </div>
    )
  }

  if (screen === SCREENS.RECAP) {
    const allItems = items || []
    const storeId = store?.id
    const total = allItems.reduce((sum, item) => {
      const s = itemStates[item.id] || {}
      const price = s.verifyState === 'updated'
        ? (s.updatedPrice ?? 0)
        : (item.prices?.[storeId] ?? 0)
      return sum + price
    }, 0)
    const savings = total * 0.10
    const observedCount = allItems.filter(item => {
      const s = itemStates[item.id] || {}
      return s.verifyState === 'confirmed' || s.verifyState === 'updated'
    }).length

    async function share() {
      const text = `I just saved $${savings.toFixed(2)} on groceries at ${store?.name ?? 'the store'} using BasketSplit! 🛒`
      if (navigator.share) {
        try { await navigator.share({ text }) } catch {}
      } else {
        try { await navigator.clipboard.writeText(text) } catch {}
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2500)
      }
    }

    return (
      <div style={{ padding: '18px 18px 60px' }}>
        <button className="back-btn" onClick={() => setScreen(SCREENS.RECEIPT)}>← Back</button>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--green)', marginBottom: 4 }}>
            Trip Complete!
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {store?.name}{store?.location ? ` · ${store.location}` : ''}
          </div>
        </div>

        {/* Total spent */}
        <div style={{
          background: 'var(--green)', borderRadius: 16, padding: '20px 24px',
          textAlign: 'center', marginBottom: 12,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.8)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
            Total Spent
          </div>
          <div style={{ fontSize: 48, fontWeight: 900, color: 'white', letterSpacing: '-2px', lineHeight: 1 }}>
            ${total.toFixed(2)}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', marginTop: 6 }}>
            {allItems.length} item{allItems.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Savings vs blind */}
        <div style={{
          background: 'var(--card-bg)', border: '1.5px solid var(--border)',
          borderRadius: 14, padding: '16px 20px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>💰</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
              Estimated savings: <span style={{ color: 'var(--green)' }}>${savings.toFixed(2)}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              vs. shopping without price data (~10% premium)
            </div>
          </div>
        </div>

        {/* Community impact */}
        <div style={{
          background: 'var(--card-bg)', border: '1.5px solid var(--border)',
          borderRadius: 14, padding: '14px 20px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <span style={{ fontSize: 26, flexShrink: 0 }}>🌱</span>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            {observedCount > 0
              ? <><span style={{ fontWeight: 800, color: 'var(--text)' }}>{observedCount} price{observedCount !== 1 ? 's' : ''} verified</span> and added to the community database.</>
              : 'Verify prices on your next trip to help the community!'
            }
          </div>
        </div>

        {/* AI nudge card */}
        <div style={{
          background: 'var(--card-bg)', border: '1.5px solid var(--amber)',
          borderRadius: 14, padding: '16px 20px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>🤖</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>AI Meal Planner</span>
            <span style={{
              fontSize: 10, fontWeight: 800, background: 'var(--green-pale)',
              color: 'var(--green)', borderRadius: 20, padding: '2px 8px',
              textTransform: 'uppercase', letterSpacing: '.4px', marginLeft: 'auto',
            }}>
              New
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
            You've got the ingredients for a great week. Try: chicken stir-fry, pasta with tomato sauce, and rice bowls with beans and veggies.
          </div>
          <button
            onClick={() => {/* AI screen wiring goes here */}}
            style={{
              background: 'none', border: '1.5px solid var(--amber)',
              borderRadius: 8, padding: '7px 14px', fontSize: 13,
              fontWeight: 700, color: 'var(--amber)', cursor: 'pointer',
            }}
          >
            Open AI Assistant →
          </button>
        </div>

        {/* Share + Done */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="cta-btn" onClick={share}>
            {shareCopied ? '✓ Copied to clipboard!' : 'Share My Savings'}
          </button>
          <button
            onClick={onBack}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: 15, fontWeight: 700, cursor: 'pointer', padding: '10px 0',
            }}
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '18px 18px 40px' }}>
      <button className="back-btn" onClick={onBack}>← Back</button>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--green)', marginBottom: 4 }}>
          How are you shopping?
        </div>
        {store && (
          <div style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 600 }}>
            {store.name}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* In Person — active */}
        <button
          onClick={() => setScreen(SCREENS.DIRECTIONS)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            background: 'var(--card-bg)',
            border: '2px solid var(--green)',
            borderRadius: 16,
            padding: '18px 20px',
            cursor: 'pointer',
            textAlign: 'left',
            width: '100%',
            boxShadow: '0 2px 10px rgba(74,124,89,.15)',
            transition: 'all .12s',
          }}
          onPointerDown={e => e.currentTarget.style.transform = 'scale(.98)'}
          onPointerUp={e => e.currentTarget.style.transform = ''}
          onPointerLeave={e => e.currentTarget.style.transform = ''}
        >
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: 'var(--green-pale)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0,
          }}>
            🛒
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 3 }}>
              Shop In Person
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Get directions, a guided checklist, and receipt capture
            </div>
          </div>
          <div style={{ color: 'var(--green)', fontSize: 20, fontWeight: 700, flexShrink: 0 }}>›</div>
        </button>

        {/* Instacart — coming soon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            background: 'var(--card-bg)',
            border: '2px solid var(--border)',
            borderRadius: 16,
            padding: '18px 20px',
            opacity: 0.55,
          }}
        >
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: '#f0f0f0', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0,
          }}>
            🥦
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>
                Order via Instacart
              </span>
              <span style={{
                fontSize: 10, fontWeight: 800, color: 'var(--text-muted)',
                background: 'var(--border)', borderRadius: 20,
                padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '.4px',
              }}>
                Coming soon
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Send your list straight to Instacart for delivery or pickup
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
