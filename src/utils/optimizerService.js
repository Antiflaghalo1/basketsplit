import { supabase } from '../lib/supabase'

export async function optimizeFromSupabase(selectedUpcs, stores) {
  if (!selectedUpcs || selectedUpcs.length === 0) {
    return { grandTotal: 0, storeBreakdown: [], unmatched: [] }
  }

  const [{ data: obsRows }, { data: productRows }] = await Promise.all([
    supabase
      .from('observations')
      .select('barcode, store_id, price')
      .in('barcode', selectedUpcs)
      .gt('price', 0)
      .lt('price', 500),
    supabase
      .from('products')
      .select('upc, name')
      .in('upc', selectedUpcs),
  ])

  const nameByUpc = {}
  for (const p of productRows || []) nameByUpc[String(p.upc)] = p.name

  // Build price map: { upc: { storeId: minPrice } }
  const priceMap = {}
  for (const row of obsRows || []) {
    if (!priceMap[row.barcode]) priceMap[row.barcode] = {}
    const cur = priceMap[row.barcode][row.store_id]
    if (cur == null || row.price < cur) priceMap[row.barcode][row.store_id] = row.price
  }

  const storeMap = {}
  const unmatched = []

  for (const upc of selectedUpcs) {
    const storePrices = priceMap[upc]
    if (!storePrices || Object.keys(storePrices).length === 0) {
      unmatched.push(upc)
      continue
    }
    const [bestStoreId, bestPrice] = Object.entries(storePrices).reduce(
      (a, b) => (a[1] < b[1] ? a : b)
    )
    if (!storeMap[bestStoreId]) {
      const store = stores.find(s => s.id === bestStoreId) ||
        { id: bestStoreId, name: bestStoreId, location: '', color: '#888888' }
      storeMap[bestStoreId] = { store, items: [], subtotal: 0 }
    }
    storeMap[bestStoreId].items.push({
      id: upc,
      name: nameByUpc[upc] ?? upc,
      bestPrice,
    })
    storeMap[bestStoreId].subtotal += bestPrice
  }

  const storeBreakdown = Object.values(storeMap).sort((a, b) => b.subtotal - a.subtotal)
  const grandTotal = storeBreakdown.reduce((sum, r) => sum + r.subtotal, 0)

  return { grandTotal, storeBreakdown, unmatched }
}
