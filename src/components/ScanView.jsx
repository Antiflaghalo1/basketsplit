import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { DecodeHintType, BarcodeFormat } from '@zxing/library'
import { STORES } from '../data/stores'
import { PRODUCTS } from '../data/products'
import { addObservation } from '../data/observations'
import { getCustomStores, addCustomStore } from '../data/customStores'

export default function ScanView({ onBack }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const [scanKey, setScanKey] = useState(0)
  const [phase, setPhase] = useState('scanning')
  const [barcode, setBarcode] = useState('')
  const [productName, setProductName] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [price, setPrice] = useState('')
  const [storeId, setStoreId] = useState(
    localStorage.getItem('basketsplit_last_store') || STORES[0].id
  )
  const [errorMsg, setErrorMsg] = useState('')
  const [customStores, setCustomStores] = useState(() => getCustomStores())
  const [showAddStore, setShowAddStore] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [addError, setAddError] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    let cancelled = false

    const timer = setTimeout(() => {
      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.UPC_A, BarcodeFormat.EAN_13])
      const reader = new BrowserMultiFormatReader(hints)

      reader
        .decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          videoRef.current,
          (result, _err, controls) => {
            if (cancelled || !result) return
            cancelled = true
            controls.stop()
            controlsRef.current = null
            const code = result.getText()
            setBarcode(code)
            setPhase('found')
            lookUpProduct(code)
          }
        )
        .then(controls => {
          if (cancelled) controls.stop()
          else controlsRef.current = controls
        })
        .catch(err => {
          if (!cancelled) {
            setPhase('error')
            setErrorMsg(err?.message || 'Camera access denied')
          }
        })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [scanKey])

  async function lookUpProduct(code) {
    if (PRODUCTS[code]) {
      setProductName(PRODUCTS[code])
      return
    }
    setLookingUp(true)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`)
      const data = await res.json()
      if (data.status === 1 && data.product?.product_name) {
        const qty = data.product.quantity ? ` ${data.product.quantity}` : ''
        setProductName(data.product.product_name + qty)
      }
    } catch {}
    setLookingUp(false)
  }

  function slugify(str) {
    return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  }

  function handleAddStore(e) {
    e.preventDefault()
    if (!newName.trim() || !newCity.trim()) {
      setAddError('Store name and city are required.')
      return
    }
    const allIds = new Set([...STORES, ...customStores].map(s => s.id))
    let base = slugify(newName.trim()) || 'store_' + Date.now()
    let id = base
    let n = 2
    while (allIds.has(id)) id = `${base}_${n++}`
    const store = {
      id,
      name: newName.trim(),
      location: newCity.trim(),
      ...(newAddress.trim() && { address: newAddress.trim() }),
      color: '#888888',
      addedAt: new Date().toISOString(),
      source: 'user_added',
    }
    addCustomStore(store)
    const updated = [...customStores, store]
    setCustomStores(updated)
    setStoreId(id)
    localStorage.setItem('basketsplit_last_store', id)
    setNewName('')
    setNewCity('')
    setNewAddress('')
    setAddError('')
    setShowAddStore(false)
    setSavedFlash(true)
  }

  function handleSave() {
    if (!price || !productName.trim()) return
    localStorage.setItem('basketsplit_last_store', storeId)
    addObservation({
      barcode,
      productName: productName.trim(),
      storeId,
      price: parseFloat(parseFloat(price).toFixed(2)),
      timestamp: Date.now(),
    })
    setPhase('saved')
  }

  function resetForNextScan() {
    setBarcode('')
    setProductName('')
    setPrice('')
    setLookingUp(false)
    setStoreId(localStorage.getItem('basketsplit_last_store') || STORES[0].id)
    setShowAddStore(false)
    setSavedFlash(false)
    setPhase('scanning')
    setScanKey(k => k + 1)
  }

  const allStores = [...STORES, ...customStores]
  const savedStore = allStores.find(s => s.id === storeId)

  return (
    <div className="scan-view">
      {phase === 'scanning' && (
        <div className="scan-camera-wrap">
          <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
          <div className="scan-overlay">
            <div className="scan-frame" />
            <p className="scan-hint">Point at a product barcode</p>
          </div>
          <button className="scan-back-btn" onClick={onBack}>← Back</button>
        </div>
      )}

      {phase === 'found' && (
        <div className="scan-form">
          <button className="back-btn" onClick={onBack}>← Cancel</button>
          <p className="scan-code-label">Barcode: <strong>{barcode}</strong></p>

          <label className="scan-label">Product Name</label>
          {lookingUp ? (
            <p className="scan-looking">Looking up product…</p>
          ) : (
            <input
              className="scan-input"
              placeholder="Enter product name"
              value={productName}
              onChange={e => setProductName(e.target.value)}
            />
          )}

          <label className="scan-label">Store</label>
          <select
            className="scan-select"
            value={storeId}
            onChange={e => { setStoreId(e.target.value); setSavedFlash(false) }}
          >
            {STORES.map(s => (
              <option key={s.id} value={s.id}>{s.name} – {s.location}</option>
            ))}
            {customStores.length > 0 && (
              <optgroup label="— My Stores —">
                {customStores.map(s => (
                  <option key={s.id} value={s.id}>{s.name} – {s.location}</option>
                ))}
              </optgroup>
            )}
          </select>

          {savedFlash && (
            <p className="add-store-flash">✓ Store saved!</p>
          )}

          {!showAddStore ? (
            <button
              type="button"
              className="add-store-btn"
              onClick={() => { setShowAddStore(true); setSavedFlash(false) }}
            >
              + Add a Store
            </button>
          ) : (
            <form className="add-store-form" onSubmit={handleAddStore}>
              <input
                className="scan-input"
                placeholder="Store Name *"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
              <input
                className="scan-input"
                placeholder="City *"
                value={newCity}
                onChange={e => setNewCity(e.target.value)}
              />
              <input
                className="scan-input"
                placeholder="Address (optional)"
                value={newAddress}
                onChange={e => setNewAddress(e.target.value)}
              />
              {addError && <p className="add-store-error">{addError}</p>}
              <div className="add-store-row">
                <button type="submit" className="add-store-submit">Save Store</button>
                <button
                  type="button"
                  className="add-store-cancel"
                  onClick={() => { setShowAddStore(false); setAddError('') }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <label className="scan-label">Price Seen Today</label>
          <div className="scan-price-wrap">
            <span className="scan-dollar">$</span>
            <input
              className="scan-input scan-price-input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
          </div>

          <button
            className="cta-btn"
            style={{ marginTop: 28 }}
            onClick={handleSave}
            disabled={!price || !productName.trim() || lookingUp}
          >
            Save Price →
          </button>
        </div>
      )}

      {phase === 'saved' && (
        <div className="scan-form scan-saved-screen">
          <div className="scan-saved-check">✓</div>
          <h2 className="scan-saved-title">Price Saved!</h2>
          <div className="scan-saved-detail">
            <span className="scan-saved-name">{productName}</span>
            <span className="scan-saved-meta">
              ${parseFloat(price).toFixed(2)} at {savedStore?.name}
            </span>
          </div>
          <button className="cta-btn" style={{ marginTop: 32 }} onClick={resetForNextScan}>
            Scan Another
          </button>
          <button className="back-btn scan-done-btn" onClick={onBack}>
            Done
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="scan-form">
          <button className="back-btn" onClick={onBack}>← Back</button>
          <div className="scan-error-box">
            <p className="scan-error-title">Camera Unavailable</p>
            <p className="scan-error-msg">{errorMsg}</p>
            <p className="scan-error-tip">
              Allow camera access in your browser settings, then tap Scan again.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}