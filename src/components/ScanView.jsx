import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { DecodeHintType, BarcodeFormat } from '@zxing/library'
import { STORES } from '../data/stores'
import { PRODUCTS } from '../data/products'

const OBS_KEY = 'basketsplit_observations'

function saveObs(obs) {
  try {
    const prev = JSON.parse(localStorage.getItem(OBS_KEY) || '[]')
    localStorage.setItem(OBS_KEY, JSON.stringify([obs, ...prev]))
  } catch {}
}

export default function ScanView({ onBack }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const [scanKey, setScanKey] = useState(0)
  const [phase, setPhase] = useState('scanning')
  const [barcode, setBarcode] = useState('')
  const [productName, setProductName] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [price, setPrice] = useState('')
  const [storeId, setStoreId] = useState(STORES[0].id)
  const [errorMsg, setErrorMsg] = useState('')

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

  function handleSave() {
    if (!price || !productName.trim()) return
    saveObs({
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
    setStoreId(STORES[0].id)
    setPhase('scanning')
    setScanKey(k => k + 1)
  }

  const savedStore = STORES.find(s => s.id === storeId)

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
            onChange={e => setStoreId(e.target.value)}
          >
            {STORES.map(s => (
              <option key={s.id} value={s.id}>{s.name} – {s.location}</option>
            ))}
          </select>

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