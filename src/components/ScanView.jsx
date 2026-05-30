import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { getAllStores } from '../data/storeService'
import { PRODUCTS } from '../data/products'
import { addObservation, upsertProduct, submitProductForReview, fetchCategorySchema, upsertProductAttribute } from '../data/observations'
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

function getBarcodeCandidates(code) {
  const s = String(code).trim()
  const candidates = new Set()
  candidates.add(String(code))
  candidates.add(s)
  if (s.startsWith('0')) candidates.add(s.slice(1))
  if (s.length === 12) candidates.add('0' + s)
  if (s.length === 11) {
    candidates.add('0' + s)
    candidates.add('00' + s)
  }
  return [...candidates]
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
  const [stagedSubmission, setStagedSubmission] = useState(false)
  const [apiLookupStatus, setApiLookupStatus] = useState(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [priceUnit, setPriceUnit] = useState('ea')
  const [promoType, setPromoType] = useState('regular')
  const [promoPrice, setPromoPrice] = useState('')
  const [promoQuantity, setPromoQuantity] = useState('')
  const [detectedStore, setDetectedStore] = useState(null)
  const [categorySchema, setCategorySchema] = useState(null)
  const [attributeValues, setAttributeValues] = useState({})
  const [taggerVisible, setTaggerVisible] = useState(false)
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

  useEffect(() => {
    setAttributeValues({})
    setTaggerVisible(false)
    setCategorySchema(null)
    if (!recognizedProduct) return
    if (!recognizedProduct.subcategory) return
    let cancelled = false
    fetchCategorySchema(recognizedProduct.subcategory).then(result => {
      if (cancelled) return
      if (!result) return
      if (result.tagger_enabled !== true) return
      const prefill = {}
      for (const key of Object.keys(result.schema)) {
        const existing = recognizedProduct.attributes?.[key]
        if (existing && (existing.confidence === 'high' || existing.confidence === 'medium')) {
          prefill[key] = existing.value
        }
      }
      setCategorySchema(result)
      setAttributeValues(prefill)
      setTaggerVisible(true)
    })
    return () => { cancelled = true }
  }, [recognizedProduct])

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
    setPricesLoading(true)
    const candidates = getBarcodeCandidates(code)
    try {
      const { data } = await supabase
        .from('observations')
        .select('barcode, store_id, price, created_at')
        .in('barcode', candidates)
        .eq('voided', false)
        .gt('price', 0)
        .lte('price', 500)
        .order('created_at', { ascending: false })
        .limit(3)
      setExistingPrices(
        (data || []).map(row => ({
          barcode: row.barcode,
          storeId: row.store_id,
          price: row.price,
          timestamp: row.created_at,
        }))
      )
    } catch {
      setExistingPrices([])
    }
    setPricesLoading(false)
  }

  function getCachedProduct(upc) {
    try {
      const cache = JSON.parse(localStorage.getItem('squrry_product_cache') || '[]')
      const candidates = new Set(getBarcodeCandidates(upc))
      return cache.find(p => candidates.has(String(p.upc))) || null
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

    const candidates = getBarcodeCandidates(code)
    const { data: dbProducts } = await supabase
      .from('products')
      .select('upc, name, brand, category, normalized_category, quantity, image_url, subcategory, variant, size_grade, package, attributes, name_source')
      .in('upc', candidates)
      .limit(1)

    const dbProduct = dbProducts?.[0] ?? null

    if (dbProduct?.name) {
      const matchedUpc = dbProduct.upc || code
      setProductName(dbProduct.name)
      setProductBrand(dbProduct.brand || '')
      setProductCategory(dbProduct.category || '')
      setProductQuantity(dbProduct.quantity || '')
      setProductImageUrl(dbProduct.image_url || '')
      setRecognizedProduct({
        image_url: dbProduct.image_url || '',
        normalized_category: dbProduct.normalized_category || '',
        subcategory: dbProduct.subcategory || null,
        attributes: dbProduct.attributes || null,
        upc: matchedUpc,
        name_source: dbProduct.name_source || null,
        source: 'squrry',
      })
      setApiLookupStatus('found')
      setLookingUp(false)
      supabase.from('observations').select('store_id, price, created_at')
        .in('barcode', candidates).eq('voided', false)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
        .then(({ data }) => { if (data) setLastObservation(data) })
        .catch(() => {})
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

  function handleAttributeChange(key, value) {
    setAttributeValues(prev => ({ ...prev, [key]: value }))
  }

  function handleSkipTagger() {
    setTaggerVisible(false)
  }

  async function handleSaveAttributes() {
    for (const [key, value] of Object.entries(attributeValues)) {
      if (value === undefined || value === null || value === '') continue
      await upsertProductAttribute({
        upc: recognizedProduct.upc,
        key,
        value,
        source: 'community',
        confidence: 'medium'
      })
    }
    setTaggerVisible(false)
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

    const canonicalBarcode = recognizedProduct?.upc || barcode

    const knownSqurryProduct = !!recognizedProduct
    const externallyFoundProduct = !recognizedProduct && apiLookupStatus === 'found'
    const unknownManualProduct = !recognizedProduct && apiLookupStatus !== 'found'

    const priceFields = {
      price: parseFloat(parsedPrice.toFixed(2)),
      price_unit: priceUnit,
      promo_type: promoType,
      promo_price: promoPrice ? parseFloat(parseFloat(promoPrice).toFixed(2)) : null,
      promo_quantity: promoQuantity ? parseInt(promoQuantity) : null,
      hasPhoto: !!photoBlob,
    }

    if (knownSqurryProduct) {
      await upsertProduct({
        upc: canonicalBarcode,
        name: finalName,
        brand: productBrand,
        category: productCategory || selectedCategory || 'Miscellaneous',
        quantity: productQuantity,
        image_url: productImageUrl,
        preserveExistingProduct: true,
      })
      const { queued } = await addObservation({
        barcode: canonicalBarcode,
        productName: finalName,
        storeId,
        ...priceFields,
        timestamp: Date.now(),
      }, user?.id)
      setSavedQueued(queued)
      setStagedSubmission(false)
    } else if (externallyFoundProduct) {
      await upsertProduct({
        upc: canonicalBarcode || barcode,
        name: finalName,
        brand: productBrand,
        category: productCategory || selectedCategory || 'Miscellaneous',
        quantity: productQuantity,
        image_url: productImageUrl,
        normalized_category: normalizeCategory(productCategory),
      })
      const { queued } = await addObservation({
        barcode: canonicalBarcode || barcode,
        productName: finalName,
        storeId,
        ...priceFields,
        timestamp: Date.now(),
      }, user?.id)
      setSavedQueued(queued)
      setStagedSubmission(false)
    } else if (unknownManualProduct) {
      const { queued } = await submitProductForReview({
        barcode,
        name: finalName,
        brand: productBrand,
        category: productCategory || selectedCategory || 'Miscellaneous',
        quantity: productQuantity,
        image_url: productImageUrl,
        storeId,
        ...priceFields,
      }, user?.id)
      setSavedQueued(queued)
      setStagedSubmission(true)
    }

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
    setStagedSubmission(false)
    setPriceUnit('ea')
    setPromoType('regular')
    setPromoPrice('')
    setPromoQuantity('')
    stopScanner()
    setPhase('scanning')
  }

  const allStores = [...stores, ...customStores]
  const savedStore = allStores.find(s => s.id === storeId)
  const autoCategory = recognizedProduct?.normalized_category || normalizeCategory(productCategory)
  const productInfoLocked = !!productName.trim() && (!!recognizedProduct || apiLookupStatus === 'found')

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
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                  {lastObservation
                    ? 'Community price found'
                    : recognizedProduct.name_source
                    ? 'Squrry fetched'
                    : 'Squrry found this'}
                </div>
                {lastObservation && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    Last seen: ${parseFloat(lastObservation.price).toFixed(2)} at {allStores.find(s => s.id === lastObservation.store_id)?.name || lastObservation.store_id} · {timeAgo(lastObservation.created_at)}
                  </div>
                )}
              </div>
            </div>
          )}

          {taggerVisible && categorySchema && (
            <div className="attribute-tagger">
              <div className="attribute-tagger-header">
                <h3>Help us tag this product</h3>
                <button
                  type="button"
                  className="attribute-tagger-skip"
                  onClick={handleSkipTagger}
                >
                  Skip
                </button>
              </div>

              {Object.entries(categorySchema.schema)
                .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99))
                .filter(([, def]) => {
                  if (!def.show_if) return true
                  return Object.entries(def.show_if).every(
                    ([k, v]) => attributeValues[k] === v
                  )
                })
                .map(([key, def]) => (
                  <div key={key} className="attribute-group">
                    <label className="attribute-label">
                      {def.label}
                      {def.required && <span className="attribute-required">*</span>}
                    </label>

                    {def.type === 'enum' && (
                      <div className="attribute-options">
                        {def.options.map(opt => (
                          <button
                            type="button"
                            key={opt}
                            className={
                              'attribute-pill' +
                              (attributeValues[key] === opt ? ' selected' : '')
                            }
                            onClick={() => handleAttributeChange(key, opt)}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}

                    {def.type === 'integer' && def.options && (
                      <div className="attribute-options">
                        {def.options.map(opt => (
                          <button
                            type="button"
                            key={opt}
                            className={
                              'attribute-pill' +
                              (attributeValues[key] === opt ? ' selected' : '')
                            }
                            onClick={() => handleAttributeChange(key, opt)}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}

                    {def.type === 'integer' && !def.options && (
                      <input
                        type="number"
                        step="1"
                        className="attribute-input"
                        value={attributeValues[key] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          handleAttributeChange(key, v === '' ? null : parseInt(v, 10))
                        }}
                      />
                    )}

                    {def.type === 'number' && (
                      <input
                        type="number"
                        step="0.01"
                        className="attribute-input"
                        value={attributeValues[key] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          handleAttributeChange(key, v === '' ? null : parseFloat(v))
                        }}
                      />
                    )}

                    {def.type === 'boolean' && (
                      <div className="attribute-options">
                        <button
                          type="button"
                          className={
                            'attribute-pill' +
                            (attributeValues[key] === true ? ' selected' : '')
                          }
                          onClick={() => handleAttributeChange(key, true)}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className={
                            'attribute-pill' +
                            (attributeValues[key] === false ? ' selected' : '')
                          }
                          onClick={() => handleAttributeChange(key, false)}
                        >
                          No
                        </button>
                      </div>
                    )}
                  </div>
                ))}

              <button
                type="button"
                className="attribute-tagger-save"
                onClick={handleSaveAttributes}
              >
                Save Tags
              </button>
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
            <>
              <input
                className="scan-input"
                placeholder="Enter product name"
                value={productName}
                readOnly={productInfoLocked}
                onChange={e => { if (!productInfoLocked) setProductName(e.target.value) }}
                style={productInfoLocked ? { color: 'var(--text-muted)', background: 'var(--surface-alt, #f5f5f5)', cursor: 'default' } : undefined}
              />
              {productInfoLocked && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  Looks right? Just add today's price.{' '}
                  <button
                    type="button"
                    onClick={() => setShowReportModal(true)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
                  >
                    Not this item?
                  </button>
                </p>
              )}
            </>
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
          <label className="scan-label">{promoType === 'regular' ? 'Price Seen Today' : 'Regular Price'}</label>
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
          <div style={{ marginTop: 12 }}>
  <label className="scan-label">Pricing Type</label>
  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
    {[
      { value: 'regular', label: '🏷️ Regular' },
      { value: 'member', label: '💳 Member price' },
      { value: 'quantity', label: '📦 Quantity deal' },
    ].map(opt => (
      <button
        key={opt.value}
        type="button"
        onClick={() => setPromoType(opt.value)}
        style={{
          padding: '4px 12px',
          borderRadius: 20,
          border: '1px solid var(--green)',
          background: promoType === opt.value ? 'var(--green)' : 'transparent',
          color: promoType === opt.value ? 'white' : 'var(--green)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        {opt.label}
      </button>
    ))}
  </div>
</div>
          {promoType === 'member' && (
  <div style={{ marginTop: 12 }}>
    <label className="scan-label">Member Price</label>
    <div className="scan-price-wrap">
      <span className="scan-dollar">$</span>
      <input
        className="scan-input scan-price-input"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        placeholder="0.00"
        value={promoPrice}
        onChange={e => setPromoPrice(e.target.value)}
      />
    </div>
  </div>
)}

{promoType === 'quantity' && (
  <div style={{ marginTop: 12 }}>
    <label className="scan-label">Quantity Deal</label>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 14, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Buy</span>
      <input
        className="scan-input"
        type="number"
        inputMode="numeric"
        min="1"
        placeholder="3"
        value={promoQuantity}
        onChange={e => setPromoQuantity(e.target.value)}
        style={{ width: 64, textAlign: 'center' }}
      />
      <span style={{ fontSize: 14, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>for</span>
      <div className="scan-price-wrap" style={{ flex: 1, minWidth: 100 }}>
        <span className="scan-dollar">$</span>
        <input
          className="scan-input scan-price-input"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={promoPrice}
          onChange={e => setPromoPrice(e.target.value)}
        />
      </div>
    </div>
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

          {showReportModal && (
            <ReportModal
              targetId={recognizedProduct?.upc || barcode}
              targetName={productName}
              userId={user?.id}
              onClose={() => setShowReportModal(false)}
            />
          )}
        </div>
      )}

      {/* ── SAVED ── */}
      {phase === 'saved' && (
        <div className="scan-form scan-saved-screen">
          <div className="scan-saved-check">✓</div>
          <h2 className="scan-saved-title">{stagedSubmission ? 'Submitted for Review!' : 'Price Saved!'}</h2>
          <div className="scan-saved-detail">
            <span className="scan-saved-name">{productName}</span>
            {stagedSubmission ? (
              <span className="scan-saved-meta">We'll review this new item before it appears in Squrry.</span>
            ) : (
              <span className="scan-saved-meta">${parseFloat(price).toFixed(2)} at {savedStore?.name}</span>
            )}
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
