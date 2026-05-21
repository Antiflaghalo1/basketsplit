import { supabase } from '../lib/supabase'

const OBS_KEY = 'basketsplit_observations'
const WEBHOOK_URL = import.meta.env.VITE_WEBHOOK_URL

export async function addObservation(obs, userId) {
  // 1. Supabase observations (primary)
  if (userId) {
    const { error } = await supabase.from('observations').insert({
      user_id: userId,
      barcode: String(obs.barcode),
      product_name: obs.productName,
      store_id: obs.storeId,
      price: obs.price,
      has_photo: obs.hasPhoto || false,
    })
    if (error) console.warn('Supabase observation write failed:', error.message)
  }

  // 2. localStorage (offline fallback)
  try {
    const prev = JSON.parse(localStorage.getItem(OBS_KEY) || '[]')
    localStorage.setItem(OBS_KEY, JSON.stringify([obs, ...prev]))
  } catch {}

  // 3. Google Sheet (transition backup — removed in 2.3)
  if (WEBHOOK_URL) {
    fetch(WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...obs, device: navigator.userAgent }),
    }).catch(() => {})
  }
}

export async function upsertProduct(product) {
  // Upsert by UPC — first scan creates, subsequent scans update last_scanned_at
  const { error } = await supabase.from('products').upsert({
    upc: String(product.upc),
    name: product.name,
    brand: product.brand || null,
    category: product.category || null,
    quantity: product.quantity || null,
    image_url: product.image_url || null,
    last_scanned_at: new Date().toISOString(),
  }, { onConflict: 'upc' })
  if (error) console.warn('Product upsert failed:', error.message)
}

export function getObservations() {
  try {
    return JSON.parse(localStorage.getItem(OBS_KEY) || '[]')
  } catch {
    return []
  }
}
