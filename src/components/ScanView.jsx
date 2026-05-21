import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { DecodeHintType, BarcodeFormat } from '@zxing/library'
import { STORES } from '../data/stores'
import { PRODUCTS } from '../data/products'
import { addObservation, upsertProduct } from '../data/observations'
import { getCustomStores, addCustomStore } from '../data/customStores'

const WEBHOOK_URL = import.meta.env.VITE_WEBHOOK_URL
const GPS_RADIUS_M = 400

// Approximate coords — fine-tune per Google Maps if needed
const STORE_COORDS = {
  walmart:   { lat: 34.0175, lng: -117.6912 },
  stater:    { lat: 33.9897, lng: -117.7201 },
  food4less: { lat: 34.0640, lng: -117.6518 },
  aldi:      { lat: 33.9839, lng: -117.7151 },
  cardenas:  { lat: 34.0576, lng: -117.6012 },
  northgate: { lat: 34.0563, lng: -117.6501 },
  sprouts:   { lat: 33.9895, lng: -117.7095 },
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function daysAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const d = Math.floor(diff / 86400000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

export default function ScanView({ onBack, user }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const shelfVideoRef = useRef(null)
  const shelfStreamRef = useRef(null)

  const [scanKey, setScanKey] = useState(0)
  const [phase, setPhase] = useState('scanning')
  const [barcode, setBarcode] = useState('')
  const [productName, setProductName] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [price, setPrice] = useState('')
  const [priceError, setPriceError] = useState('')
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

  // Phase 2.1
  const [productBrand, setProductBrand] = useState('')
  const [productCategory, setProductCategory] = useState('')
  const [productQuantity, setProductQuantity] = useState('')
  const [productImageUrl, setProductImageUrl] = useState('')
  const [existingPrices, setExistingPrices] = useState([])
  const [pricesLoading, setPricesLoading] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('idle')
  const [gpsStoreName, setGpsStoreName] = useState('')
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null)
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoCapturing, setPhotoCapturing] = useState(false)

  // GPS — runs once on mount
  useEffect(() => {
    if (!navigator.geolocation) return
    setGpsStatus('detecting')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        let closestId = null
        let minDist = Infinity
        for (const [id, coords] of Object.entries(STORE_COORDS)) {
          const dist = haversine(latitude, longitude, coords.lat, coords.lng)
          if (dist < minDist) {
            minDist = dist
            closestId = id
          }
        }
        if (closestId && minDist <= GPS_RADIUS_M) {
          const allStores = [...STORES, ...getCustomStores()]
          const match = allStores.find(s => s.id === closestId)
          if (match) {
            setStoreId(closestId)
            setGpsStoreName(match.name)
            setGpsStatus('detected')
            return
          }
        }
        setGpsStatus('failed')
      },
      () => setGpsStatus('failed'),
      { timeout: 8000, maximumAge: 60000 }
    )
  }, [])

  // Barcode scanner
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
            fetchExistingPrices(code)
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

  // Stop shelf camera on unmount
  useEffect(() => {
    return () => stopShelfCamera()
  }, [])

  async function fetchExistingPrices(code) {
    if (!WEBHOOK_URL) return
    setPricesLoading(true)
    try {
      const res = await fetch(WEBHOOK_URL)
      const data = await res.json()
      const matches = data
        .filter(row =>
          String(row.barcode) === String(code) &&
          Number(row.price) > 0 &&
          Number(row.price) <= 200
        )
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 3)
      setExistingPrices(matches)
    } catch {
      setExistingPrices([])
    }
    setPricesLoading(false)
  }

  async function lookUpProduct(code) {
    setProductBrand('')
    setProductCategory('')
    setProductQuantity('')
    setProductImageUrl('')

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
        setProductBrand(data.product.brands || '')
        setProductCategory((data.product.categories || '').split(',')[0]?.trim() || '')
        setProductQuantity(data.product.quantity || '')
        setProductImageUrl(data.product.image_front_url || data.product.image_url || '')
      }
    } catch {}
    setLookingUp(false)
  }

  // ── Shelf camera (low-res live stream, no file input) ──
  async function startShelfCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
        },
        audio: false,
      })
      shelfStreamRef.current = stream
      setPhotoCapturing(true)
      // wait for video element to mount before attaching stream
      setTimeout(() => {
        if (shelfVideoRef.current) {
          shelfVideoRef.current.srcObject = stream
          shelfVideoRef.current.play()
        }
      }, 300)
    } catch {
      // silently fail — photo is optional
    }
  }

  function captureShelfPhoto() {
    const video = shelfVideoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = Math.round(video.videoHeight * (640 / video.videoWidth))
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
        setPhotoBlob(blob)
        setPhotoPreviewUrl(URL.createObjectURL(blob))
        canvas.width = 0
        canvas.height = 0
        stopShelfCamera()
        setPhotoCapturing(false)
      },
      'image/jpeg',
      0.6
    )
  }

  function stopShelfCamera() {
    shelfStreamRef.current?.getTracks().forEach(t => t.stop())
    shelfStreamRef.current = null
  }

  function discardPhoto() {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
    setPhotoPreviewUrl(null)
    setPhotoBlob(null)
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

  async function handleSave() {
    const parsedPrice = parseFloat(price)
    setPriceError('')
    if (!price || !productName.trim()) return
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setPriceError("Hmm, that doesn't look right. Price has to be more than $0 👀")
      return
    }
    if (parsedPrice > 200) {
      setPriceError('Whoa, over $200? Double check that — might be an extra zero in there 🤔')
      return
    }
    localStorage.setItem('basketsplit_last_store', storeId)
    await upsertProduct({
      upc: barcode,
      name: productName.trim(),
      brand: productBrand,
      category: productCategory,
      quantity: productQuantity,
      image_url: productImageUrl,
    })
    await addObservation({
      barcode,
      productName: productName.trim(),
      storeId,
      price: parseFloat(parsedPrice.toFixed(2)),
      timestamp: Date.now(),
      hasPhoto: !!photoBlob,
    }, user?.id)
    setPhase('saved')
  }

  function resetForNextScan() {
    discardPhoto()
    setBarcode('')
    setProductName('')
    setProductBrand('')
    setProductCategory('')
    setProductQuantity('')
    setProductImageUrl('')
    setPrice('')
    setPriceError('')
    setLookingUp(false)
    setExistingPrices([])
    setStoreId(localStorage.getItem('basketsplit_last_store') || STORES[0].id)
    setShowAddStore(false)
    setSavedFlash(false)
    setPhotoCapturing(false)
    setPhase('scanning')
    setScanKey(k => k + 1)
  }

  const allStores = [...STORES, ...customStores]
  const savedStore = allStores.find(s => s.id === storeId)

  return (
    <div className="scan-view">

      {/* ── SCANNING ── */}
      {phase === 'scanning' && (
        <div className="scan-camera-wrap">
          <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
          <div className="scan-overlay">
            <div className="scan-frame" />
            <p className="scan-hint">Point at a product barcode</p>
            {gpsStatus === 'detected' && (
              <p className="scan-gps-badge">📍 {gpsStoreName} detected</p>
            )}
          </div>
          <button className="scan-back-btn" onClick={onBack}>← Back</button>
        </div>
      )}

      {/* ── FOUND ── */}
      {phase === 'found' && (
        <div className="scan-form">
          <button className="back-btn" onClick={onBack}>← Cancel</button>
          <p className="scan-code-label">Barcode: <strong>{barcode}</strong></p>

          {/* Existing prices */}
          {pricesLoading && (
            <div className="existing-prices-loading">🔍 Checking our database…</div>
          )}
          {!pricesLoading && existingPrices.length > 0 && (
            <div className="existing-prices-card">
              <p className="existing-prices-title">📊 We have this item</p>
              {existingPrices.map((row, i) => {
                const store = allStores.find(s => s.id === row.storeId)
                return (
                  <div key={i} className="existing-price-row">
                    <span className="existing-price-amount">${parseFloat(row.price).toFixed(2)}</span>
                    <span className="existing-price-store">{store?.name ?? row.storeId}</span>
                    <span className="existing-price-age">{daysAgo(row.timestamp)}</span>
                  </div>
                )
              })}
              <p className="existing-prices-cta">Still accurate? Update below ↓</p>
            </div>
          )}

          {/* Product name */}
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

          {/* Store */}
          <label className="scan-label">Store</label>
          {gpsStatus === 'detected' && (
            <p className="gps-detected-label">📍 Auto-detected: {gpsStoreName}</p>
          )}
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

          {savedFlash && <p className="add-store-flash">✓ Store saved!</p>}

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
              <input className="scan-input" placeholder="Store Name *" value={newName} onChange={e => setNewName(e.target.value)} />
              <input className="scan-input" placeholder="City *" value={newCity} onChange={e => setNewCity(e.target.value)} />
              <input className="scan-input" placeholder="Address (optional)" value={newAddress} onChange={e => setNewAddress(e.target.value)} />
              {addError && <p className="add-store-error">{addError}</p>}
              <div className="add-store-row">
                <button type="submit" className="add-store-submit">Save Store</button>
                <button type="button" className="add-store-cancel" onClick={() => { setShowAddStore(false); setAddError('') }}>Cancel</button>
              </div>
            </form>
          )}

          {/* Price */}
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
              onChange={e => { setPrice(e.target.value); setPriceError('') }}
            />
          </div>
          {priceError && (
            <p style={{ color: '#C62828', fontSize: 13, marginTop: 8 }}>{priceError}</p>
          )}

          {/* Shelf photo — live stream capture */}
          <label className="scan-label" style={{ marginTop: 20 }}>
            Shelf Tag Photo{' '}
            <span style={{ fontWeight: 400, opacity: 0.55 }}>(optional)</span>
          </label>

          {photoCapturing && (
            <div className="shelf-camera-wrap">
              <video
                ref={shelfVideoRef}
                className="shelf-video"
                playsInline
                muted
                autoPlay
              />
              <div className="shelf-camera-btns">
                <button className="cta-btn" onClick={captureShelfPhoto}>📷 Capture</button>
                <button className="add-store-cancel" onClick={() => { stopShelfCamera(); setPhotoCapturing(false) }}>Cancel</button>
              </div>
            </div>
          )}

          {!photoCapturing && !photoPreviewUrl && (
            <button type="button" className="add-store-btn" onClick={startShelfCamera}>
              📷 Take Photo of Shelf Tag
            </button>
          )}

          {!photoCapturing && photoPreviewUrl && (
            <div className="photo-preview-wrap">
              <img src={photoPreviewUrl} alt="Shelf tag" className="photo-preview" />
              <button type="button" className="add-store-cancel" onClick={discardPhoto}>Remove</button>
            </div>
          )}

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

      {/* ── SAVED ── */}
      {phase === 'saved' && (
        <div className="scan-form scan-saved-screen">
          <div className="scan-saved-check">✓</div>
          <h2 className="scan-saved-title">Price Saved!</h2>
          <div className="scan-saved-detail">
            <span className="scan-saved-name">{productName}</span>
            <span className="scan-saved-meta">${parseFloat(price).toFixed(2)} at {savedStore?.name}</span>
            {photoBlob && <span className="scan-saved-meta">📷 Photo attached</span>}
          </div>
          <button className="cta-btn" style={{ marginTop: 32 }} onClick={resetForNextScan}>Scan Another</button>
          <button className="back-btn scan-done-btn" onClick={onBack}>Done</button>
        </div>
      )}

      {/* ── ERROR ── */}
      {phase === 'error' && (
        <div className="scan-form">
          <button className="back-btn" onClick={onBack}>← Back</button>
          <div className="scan-error-box">
            <p className="scan-error-title">Camera Unavailable</p>
            <p className="scan-error-msg">{errorMsg}</p>
            <p className="scan-error-tip">Allow camera access in your browser settings, then tap Scan again.</p>
          </div>
        </div>
      )}
    </div>
  )
}
