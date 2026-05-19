import { STORES, ITEMS } from '../data/stores'

export function optimizeBasket(selectedItemIds) {
  const results = {}

  selectedItemIds.forEach(itemId => {
    const item = ITEMS.find(i => i.id === itemId)
    if (!item) return

    let cheapestStoreId = null
    let cheapestPrice = Infinity

    Object.entries(item.prices).forEach(([storeId, price]) => {
      if (price < cheapestPrice) {
        cheapestPrice = price
        cheapestStoreId = storeId
      }
    })

    if (!cheapestStoreId) return

    if (!results[cheapestStoreId]) {
      const store = STORES.find(s => s.id === cheapestStoreId)
      results[cheapestStoreId] = { store, items: [], subtotal: 0 }
    }

    results[cheapestStoreId].items.push({ ...item, bestPrice: cheapestPrice })
    results[cheapestStoreId].subtotal += cheapestPrice
  })

  const storeBreakdown = Object.values(results).sort((a, b) => b.subtotal - a.subtotal)
  const grandTotal = storeBreakdown.reduce((sum, r) => sum + r.subtotal, 0)

  return { storeBreakdown, grandTotal }
}