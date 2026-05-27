import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { getAllStores } from '../data/storeService'
import { PRODUCTS } from '../data/products'
import { addObservation, upsertProduct } from '../data/observations'
import { getCustomStores, addCustomStore } from '../data/customStores'
import { supabase } from '../lib/supabase'
import ReportModal from './ReportModal'
import normalizeCategory from '../utils/normalizeCategory'

const WEBHOOK_URL = import.meta.env.VITE_WEBHOOK_URL
const GPS_RADIUS_M = 500

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

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export default function ScanView({ onBack, user }) {
  const oldStore = localStorage.getItem('basketsplit_last_store')
  if (oldStore) {
    localStorage.setItem('squrry_last_store', oldStore)
    localStorage.removeItem('basketsplit_last_store')
  }

  const html5QrRef = useRef(null)
  const shelfVideoRef = useRef(null)
  const shelfStreamRef = useRef(null)

  const [stores, setStores] = useState([])
  const storesRef = useRef([])

  const [phase, setPhase] = useState('scanning')
  const [barcode, setBarcode] = useState('')
  const [productName, setProductName] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [price, setPrice] = useState('')
  const [priceError, setPriceError] = useState('')
  const [storeId, setStoreId] = useState(
    localStorage.getItem('squrry_last_store') || ''
  )
  const [errorMsg, setErrorMsg] = useState('')
  const [customStores, setCustomStores] = useState(() => getCustomStores())
  const [showAddStore, setShowAddStore] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [addressError, setAddressError] = useState('')
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
  const [gpsCoords, setGpsCoords] = useState(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null)
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoCapturing, setPhotoCapturing] = useState(false)
  const [recognizedProduct, setRecognizedProduct] = useState(null)
  const [lastObservation, setLastObservation] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [showReportModal, setShowReportModal] = useState(false)
  const [savedQueued, setSavedQueued] = useState(false)
  const [apiLookupStatus, setApiLookupStatus] = useState(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [priceUnit, setPriceUnit] = useState('ea')
  const [detectedStore, setDetectedStore] = useState(null)
  const watchIdRef = useRef(null)
  const pollIntervalRef = useRef(null)
  const detectedStoreRef = useRef(null)

  function runGpsDetection() {
    if (!navigator.geolocation) return
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
    }
    setGpsStatus('detecting')

    function handlePosition(pos) {
      const { latitude, longitude } = pos.coords
      setGpsCoords({ lat: latitude, lng: longitude })
      let closestId = null
      let minDist = Infinity
      for (const store of storesRef.current) {
        const dist = haversine(latitude, longitude, store.lat, store.lng)
        if (dist < minDist) {
          minDist = dist
          closestId = store.id
        }
      }
      if (closestId && minDist <= GPS_RADIUS_M) {
        const allStores = [...storesRef.current, ...getCustomStores()]
        const match = allStores.find(s => s.id === closestId)
        if (match) {
          if (detectedStoreRef.current?.id !== closestId) {
            setStoreId(closestId)
            setGpsStoreName(match.name)
            setGpsStatus('detected')
            setDetectedStore(match)
            detectedStoreRef.current = match
          }
          return
        }
      }
      setGpsStatus('failed')
    }

    const cached = localStorage.getItem('squrry_last_coords')
    if (cached) {
      try {
        const c = JSON.parse(cached)
        if (Date.now() - c.ts < 600000) {
          handlePosition({ coords: { latitude: c.lat, longitude: c.lng } })
        }
      } catch {}
    }

    navigator.geolocation.getCurrentPosition(
      handlePosition,
      () => setGpsStatus('failed'),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }
    )

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      () => setGpsStatus('failed'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  // Load stores from Supabase, then start continuous GPS watch
  useEffect(() => {
    let intervalId = null
    getAllStores().then(data => {
      setStores(data)
      storesRef.current = data
      setStoreId(prev => prev || data[0]?.id || '')
      runGpsDetection()
      pollIntervalRef.current = setInterval(runGpsDetection, 10000)
      intervalId = setInterval(runGpsDetection, 20000)
    })

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      clearInterval(pollIntervalRef.current)
      if (intervalId !== null) clearInterval(intervalId)
    }
  }, [])

  async function toggleTorch() {
    try {
      await html5QrRef.current.applyVideoConstraints({
        advanced: [{ torch: !torchOn }]
      })
      setTorchOn(prev => !prev)
    } catch {}
  }

  async function stopScanner() {
    if (html5QrRef.current) {
      try {
        await html5QrRef.current.stop()
        html5QrRef.current.clear()
      } catch (e) {}
      html5QrRef.current = null
    }
  }

  // Barcode scanner
  useEffect(() => {
    if (phase !== 'scanning') return
    const html5Qr = new Html5Qrcode('squrry-scanner-region')
    html5QrRef.current = html5Qr
    html5Qr.start(
      { facingMode: 'environment' },
      {
        fps: 15,
        aspectRatio: 1.777,
        disableFlip: false,
        focusMode: 'continuous',
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
        advanced: [{ zoom: 2.0 }],
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
        ],
      },
      (decodedText) => {
        if (phase !== 'scanning') return
        stopScanner()
        setBarcode(decodedText)
        setPhase('found')
        lookUpProduct(decodedText)
        fetchExistingPrices(decodedText)
      },
      (_errorMessage) => {
        // Scan attempt failure — fires constantly while searching for a barcode
      }
    ).then(async () => {
      try {
        const capabilities = await html5QrRef.current.getRunningTrackCapabilities()
        if (capabilities.torch) setTorchSupported(true)
      } catch {}
    }).catch(err => {
      setPhase('error')
      setErrorMsg(err?.message || 'Camera access denied')
    })
    return () => { stopScanner() }
  }, [phase])

  // Stop shelf camera on unmount
  useEffect(() => {
    return () => stopShelfCamera()
  }, [])

  // Seed / refresh local product cache (24-hour TTL)
  useEffect(() => {
    async function refreshCache() {
      const cacheTime = parseInt(localStorage.getItem('squrry_cache_time') || '0')
      const stale = Date.now() - cacheTime > 24 * 60 * 60 * 1000
      if (!stale) return
      try {
        const { data } = await supabase
          .from('products')
          .select('upc, name, brand, normalized_category, image_url, category')
        if (data) {
          localStorage.setItem('squrry_product_cache', JSON.stringify(data))
          localStorage.setItem('squrry_cache_time', Date.now().toString())
        }
      } catch {} // offline — keep existing cache
    }
    refreshCache()
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

  function getCachedProduct(upc) {
    try {
      const cache = JSON.parse(localStorage.getItem('squrry_product_cache') || '[]')
      return cache.find(p => String(p.upc) === String(upc)) || null
    } catch { return null }
  }

  function queueForRelookup(code) {
    try {
      const queue = JSON.parse(localStorage.getItem('squrry_relookup_queue') || '[]')
      if (!queue.includes(String(code))) {
        queue.push(String(code))
        localStorage.setItem('squrry_relookup_queue', JSON.stringify(queue))
      }
    } catch {}
  }

  async function runFullLookupWaterfall(code) {
    setLookingUp(true)

    const { data: dbProduct } = await supabase
      .from('products')
      .select('name, brand, category, normalized_category, quantity, image_url')
      .eq('upc', code)
      .maybeSingle()

    if (dbProduct?.name) {
      setProductName(dbProduct.name)
      setProductBrand(dbProduct.brand || '')
      setProductCategory(dbProduct.category || '')
      setProductQuantity(dbProduct.quantity || '')
      setProductImageUrl(dbProduct.image_url || '')
      setRecognizedProduct({ image_url: dbProduct.image_url || '', normalized_category: dbProduct.normalized_category || '' })
      setApiLookupStatus('found')
      supabase.from('observations').select('store_id, price, created_at')
        .eq('barcode', code).eq('voided', false)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
        .then(({ data }) => { if (data) setLastObservation(data) })
        .catch(() => {})
      setLookingUp(false)
      return
    }

    if (PRODUCTS[code]) {
      setProductName(PRODUCTS[code])
      setApiLookupStatus('found')
      setLookingUp(false)
      return
    }

    let imageUrl = ''
    let brand = ''
    let category = ''
    let offOk = false
    let offFound = false
    let upcOk = false

    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`)
      if (res.ok) {
        offOk = true
        const data = await res.json()
        if (data.status === 1 && data.product?.product_name) {
          offFound = true
          const qty = data.product.quantity ? ` ${data.product.quantity}` : ''
          setProductName(data.product.product_name + qty)
          brand = data.product.brands || ''
          setProductBrand(brand)
          category = (data.product.categories || '').split(',')[0]?.trim() || ''
          setProductCategory(category)
          setProductQuantity(data.product.quantity || '')
          imageUrl = data.product.image_front_url || data.product.image_url || ''
          setProductImageUrl(imageUrl)
        }
      }
    } catch {}

    if (!imageUrl) {
      try {
        const res2 = await fetch(`/api/lookup?upc=${encodeURIComponent(code)}`)
        if (res2.ok) {
          upcOk = true
          const data2 = await res2.json()
          if (data2.image_url) setProductImageUrl(data2.image_url)
          if (!brand && data2.brand) setProductBrand(data2.brand)
          if (!category && data2.category) setProductCategory(data2.category)
        }
      } catch {}
    }

    if (offFound) {
      setApiLookupStatus('found')
    } else if (offOk || upcOk) {
      setApiLookupStatus('not_found')
    } else {
      setApiLookupStatus('error')
      queueForRelookup(code)
    }

    setLookingUp(false)
  }

  async function lookUpProduct(code) {
    setProductBrand('')
    setProductCategory('')
    setProductQuantity('')
    setProductImageUrl('')
    setRecognizedProduct(null)
    setLastObservation(null)
    setApiLookupStatus(null)

    const localHit = getCachedProduct(code)
    if (localHit) {
      setProductName(localHit.name || '')
      setProductBrand(localHit.brand || '')
      setProductCategory(localHit.category || '')
      setProductImageUrl(localHit.image_url || '')
      setRecognizedProduct({
        image_url: localHit.image_url || '',
        normalized_category: localHit.normalized_category || '',
      })
      setApiLookupStatus('found')
      setLookingUp(false)
      supabase.from('observations').select('store_id, price, created_at')
        .eq('barcode', code).eq('voided', false)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
        .then(({ data }) => { if (data) setLastObservation(data) })
        .catch(() => {})
      return
    }

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 5000))
    try {
      await Promise.race([runFullLookupWaterfall(code), timeout])
    } catch {
      setLookingUp(false)
      setApiLookupStatus('error')
      queueForRelookup(code)
    }
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
    if (!newAddress.trim()) {
      setAddressError('Address is required')
      return
    }
    setAddressError('')
    const allIds = new Set([...stores, ...customStores].map(s => s.id))
    let base = slugify(newName.trim()) || 'store_' + Date.now()
    let id = base
    let n = 2
    while (allIds.has(id)) id = `${base}_${n++}`
    const store = {
      id,
      name: newName.trim(),
      location: newCity.trim(),
      address: newAddress.trim(),
      color: '#888888',
      addedAt: new Date().toISOString(),
      source: 'user_added',
      lat: gpsCoords?.lat ?? null,
      lng: gpsCoords?.lng ?? null,
    }
    addCustomStore(store)
    const updated = [...customStores, store]
    setCustomStores(updated)
    setStoreId(id)
    localStorage.setItem('squrry_last_store', id)
    setNewName('')
    setNewCity('')
    setNewAddress('')
    setAddError('')
    setAddressError('')
    setShowAddStore(false)
    setSavedFlash(true)
  }

  async function handleSave() {
    const parsedPrice = parseFloat(price)
    setPriceError('')
    if (!price) return
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setPriceError("Hmm, that doesn't look right. Price has to be more than $0 👀")
      return
    }
    if (parsedPrice > 200) {
      setPriceError('Whoa, over $200? Double check that — might be an extra zero in there 🤔')
      return
    }
    const finalName = productName.trim() || `Item #${barcode}`
    if (!productName.trim()) setProductName(finalName)
    localStorage.setItem('squrry_last_store', storeId)
    await upsertProduct({
      upc: barcode,
      name: finalName,
      brand: productBrand,
      category: productCategory || selectedCategory || 'Miscellaneous',
      quantity: productQuantity,
      image_url: productImageUrl,
      ...(!recognizedProduct && {
        normalized_category: apiLookupStatus === 'found'
          ? normalizeCategory(productCategory)
          : selectedCategory || 'Miscellaneous',
      }),
    })
    const { queued } = await addObservation({
      barcode,
      productName: finalName,
      storeId,
      price: parseFloat(parsedPrice.toFixed(2)),
      price_unit: priceUnit,
      timestamp: Date.now(),
      hasPhoto: !!photoBlob,
    }, user?.id)
    setSavedQueued(queued)
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
    setStoreId(localStorage.getItem('squrry_last_store') || stores[0]?.id || '')
    setShowAddStore(false)
    setSavedFlash(false)
    setPhotoCapturing(false)
    setRecognizedProduct(null)
    setLastObservation(null)
    setSelectedCategory('')
    setApiLookupStatus(null)
    setShowReportModal(false)
    setSavedQueued(false)
    setPriceUnit('ea')
    stopScanner()
    setPhase('scanning')
  }

  const allStores = [...stores, ...customStores]
  const savedStore = allStores.find(s => s.id === storeId)
  const autoCategory = recognizedProduct?.normalized_category || normalizeCategory(productCategory)

  return (
    <div className="scan-view">

      {/* ── SCANNING ── */}
      {phase === 'scanning' && (
        <div className="scan-camera-wrap">
          <div
            id="squrry-scanner-region"
            style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
          />
          <div style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            pointerEvents: 'auto'
          }}>
            {detectedStore && (
              <div style={{
                background: 'var(--green-pale)',
                border: '1px solid var(--green)',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 14,
                color: 'var(--green-dark)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                margin: '8px 8px 0',
              }}>
                <span>📍 {detectedStore.name} detected — selected automatically</span>
                <button
                  onClick={() => { setDetectedStore(null); detectedStoreRef.current = null }}
                  style={{ background: 'none', border: 'none', color: 'var(--green-dark)', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '0 2px', flexShrink: 0, pointerEvents: 'auto' }}
                  aria-label="Dismiss"
                >×</button>
              </div>
            )}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', padding: '4px 0', pointerEvents: 'auto' }}
              onClick={runGpsDetection}
            >
              📍 Change store
            </button>
          </div>
          <div className="scan-overlay">
            <div className="scan-frame-box">
              <div className="scan-corner-tl" />
              <div className="scan-corner-tr" />
              <div className="scan-corner-bl" />
              <div className="scan-corner-br" />
              <div className="scan-laser" />
            </div>
            <p className="scan-hint">Align barcode within the frame</p>
            <button
              className="scan-manual-btn"
              style={{ pointerEvents: 'auto' }}
              onClick={() => { setPhase('found'); setBarcode(''); setProductName('') }}
            >
              Enter barcode manually →
            </button>
            {gpsStatus === 'detected' && (
              <p className="scan-gps-badge">📍 {gpsStoreName} detected</p>
            )}
          </div>
          {torchSupported && (
            <button className="torch-btn" onClick={toggleTorch}>
              {torchOn ? '🔦 On' : '🔦 Off'}
            </button>
          )}
          <button className="scan-back-btn" style={{ pointerEvents: 'auto' }} onClick={onBack}>← Back</button>
        </div>
      )}

      {/* ── FOUND ── */}
      {phase === 'found' && (
        <div className="scan-form">
          <button className="back-btn" onClick={onBack}>← Cancel</button>
          <p className="scan-code-label">Barcode: <strong>{barcode}</strong></p>

          {recognizedProduct && (
            <div className="scan-recognized-banner">
              {recognizedProduct.image_url ? (
                <img src={recognizedProduct.image_url} alt={productName} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 48, height: 48, borderRadius: 8, background: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🛒</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--green)', fontSize: 12, fontWeight: 700 }}>✅ We know this!</div>
                <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{productName}</div>
                {recognizedProduct.normalized_category && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{recognizedProduct.normalized_category}</div>
                )}
                {lastObservation && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    Last seen: ${parseFloat(lastObservation.price).toFixed(2)} at {allStores.find(s => s.id === lastObservation.store_id)?.name || lastObservation.store_id} · {timeAgo(lastObservation.created_at)}
                  </div>
                )}
              </div>
            </div>
          )}

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

          {/* Category */}
          {!lookingUp && (
            <div className="scan-field">
              <label className="scan-label">Category</label>
              {(recognizedProduct || apiLookupStatus === 'found') ? (
                <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>{autoCategory}</p>
              ) : apiLookupStatus === 'error' ? (
                <>
                  <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>Miscellaneous</p>
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>Category auto-detected when connection improves.</p>
                </>
              ) : (
                <select
                  className="scan-input"
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                >
                  <option value="">Select a category…</option>
                  <option value="Meat & Seafood">Meat &amp; Seafood</option>
                  <option value="Dairy & Eggs">Dairy &amp; Eggs</option>
                  <option value="Produce">Produce</option>
                  <option value="Bakery & Bread">Bakery &amp; Bread</option>
                  <option value="Pantry & Canned">Pantry &amp; Canned</option>
                  <option value="Frozen">Frozen</option>
                  <option value="Beverages">Beverages</option>
                  <option value="Snacks">Snacks</option>
                  <option value="Pet Care">Pet Care</option>
                  <option value="Health & Beauty">Health &amp; Beauty</option>
                  <option value="Household & Cleaning">Household &amp; Cleaning</option>
                  <option value="Baby & Kids">Baby &amp; Kids</option>
                  <option value="Deli & Prepared">Deli &amp; Prepared</option>
                  <option value="Miscellaneous">Miscellaneous</option>
                </select>
              )}
            </div>
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
            {stores.map(s => (
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
              <input className="scan-input" placeholder="Address *" value={newAddress} onChange={e => setNewAddress(e.target.value)} />
              {addressError && <p className="add-store-error">{addressError}</p>}
              {addError && <p className="add-store-error">{addError}</p>}
              <div className="add-store-row">
                <button type="submit" className="add-store-submit">Save Store</button>
                <button type="button" className="add-store-cancel" onClick={() => { setShowAddStore(false); setAddError(''); setAddressError('') }}>Cancel</button>
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
          {(autoCategory === 'Meat & Seafood' || autoCategory === 'Produce' ||
  selectedCategory === 'Meat & Seafood' || selectedCategory === 'Produce') && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', alignSelf: 'center' }}>Priced per:</span>
              {['ea', 'lb', 'oz', 'kg'].map(unit => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setPriceUnit(unit)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    border: '1px solid var(--green)',
                    background: priceUnit === unit ? 'var(--green)' : 'transparent',
                    color: priceUnit === unit ? 'white' : 'var(--green)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {unit === 'ea' ? 'flat price' : `/ ${unit}`}
                </button>
              ))}
            </div>
          )}
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
            disabled={!price || lookingUp || (!!productName.trim() && !recognizedProduct && (apiLookupStatus === 'not_found' || apiLookupStatus === null) && !selectedCategory)}
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
            {savedQueued && (
              <span style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>Saved locally — will sync when online</span>
            )}
          </div>
          <button
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', padding: '4px 0', marginTop: 8 }}
            onClick={() => setShowReportModal(true)}
          >
            ⚠️ Something not right? Report it
          </button>
          <button className="cta-btn" style={{ marginTop: 24 }} onClick={resetForNextScan}>Scan Another</button>
          <button className="back-btn scan-done-btn" onClick={onBack}>Done</button>
          {showReportModal && (
            <ReportModal
              targetId={barcode}
              targetName={productName}
              userId={user?.id}
              onClose={() => setShowReportModal(false)}
            />
          )}
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
