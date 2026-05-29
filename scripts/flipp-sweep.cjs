const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const SUPABASE_URL        = process.env.SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  realtime: { transport: ws }
})

// ─── CONFIG ────────────────────────────────────────────────
const POSTAL_CODE = '91710' // Single zip — Flipp search returns regional results

const SEARCH_TERMS = [
  'eggs', 'milk', 'butter', 'cheese', 'yogurt', 'cream',
  'chicken', 'ground beef', 'beef', 'pork', 'salmon', 'shrimp',
  'bacon', 'sausage', 'hot dogs', 'turkey',
  'bread', 'tortillas', 'rice', 'pasta', 'cereal', 'oatmeal',
  'olive oil', 'cooking oil', 'sugar', 'flour',
  'canned beans', 'canned tomatoes', 'soup',
  'orange juice', 'water', 'coffee',
  'potatoes', 'onions', 'apples', 'bananas', 'avocado',
  'snacks', 'chips',
  'laundry detergent', 'paper towels', 'toilet paper', 'trash bags',
  'diapers', 'dish soap',
]

// Merchant name → Supabase store IDs
const STORE_MAP = {
  'walmart':                ['walmart_chino', 'walmart_ontario'],
  'stater bros':            ['staters_chino_schaefer_ave', 'staters_chino_riverside_dr', 'staters_chino_pine_ave', 'staters_chinohills', 'staters_ontario_ontario_ranch_rd', 'staters_ontario_4th_st', 'staters_ontario_philadelphia_st', 'staters_ontario_holt_blvd', 'staters_ontario_haven_ave'],
  'stater bros markets':    ['staters_chino_schaefer_ave', 'staters_chino_riverside_dr', 'staters_chino_pine_ave', 'staters_chinohills', 'staters_ontario_ontario_ranch_rd', 'staters_ontario_4th_st', 'staters_ontario_philadelphia_st', 'staters_ontario_holt_blvd', 'staters_ontario_haven_ave'],
  'stater bros. markets':   ['staters_chino_schaefer_ave', 'staters_chino_riverside_dr', 'staters_chino_pine_ave', 'staters_chinohills', 'staters_ontario_ontario_ranch_rd', 'staters_ontario_4th_st', 'staters_ontario_philadelphia_st', 'staters_ontario_holt_blvd', 'staters_ontario_haven_ave'],
  'food 4 less':            ['food4less_ontario'],
  'aldi':                   ['aldi_chino'],
  'sprouts':                ['sprouts_chinohills'],
  'sprouts farmers market': ['sprouts_chinohills'],
  'cardenas':               ['cardenas_chino', 'cardenas_ontario_vineyard_ave', 'cardenas_ontario_holt_blvd', 'cardenas_ontario_euclid_ave', 'cardenas_ontario_4th_st'],
  'cardenas markets':       ['cardenas_chino', 'cardenas_ontario_vineyard_ave', 'cardenas_ontario_holt_blvd', 'cardenas_ontario_euclid_ave', 'cardenas_ontario_4th_st'],
  'northgate':              ['northgate_chino'],
  'northgate gonzalez':     ['northgate_chino'],
  'target':                 ['target_chino_grand_ave', 'target_chino_philadelphia_st', 'target_ontario_main', 'target_ontario_north', 'target_murrieta_clinton_keith_rd', 'target_murrieta_south'],
  'smart & final':          ['smartandfinal_chino', 'smartandfinal_chinohills', 'smartandfinal_ontario', 'smartandfinal_murrieta'],
  'smart & final extra':    ['smartandfinal_chino', 'smartandfinal_chinohills', 'smartandfinal_ontario', 'smartandfinal_murrieta'],
  'ralphs':                 ['ralphs_ontario'],
  'superior':               ['superior_chino', 'superior_ontario'],
  'superior grocers':       ['superior_chino', 'superior_ontario'],
  'grocery outlet':         ['groceryoutlet_chinohills', 'groceryoutlet_ontario'],
  'trader joe\'s':          ['traderjoes_chinohills'],
  'trader joes':            ['traderjoes_chinohills'],
  'albertsons':             ['albertsons_chino', 'albertsons_chinohills'],
  '99 ranch':               ['99ranch_chino', '99ranch_chinohills'],
  '99 ranch market':        ['99ranch_chino', '99ranch_chinohills'],
}

const DELAY_MS = 800
const CHUNK    = 500
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── HELPERS ───────────────────────────────────────────────
function resolveStoreIds(merchantName) {
  return STORE_MAP[merchantName?.toLowerCase().trim()] || []
}

function parsePrice(val) {
  if (val == null) return null
  const n = parseFloat(val)
  return isNaN(n) || n <= 0 || n > 500 ? null : n
}

function parseMinQty(text) {
  if (!text) return null
  const match = text.match(/\b(\d+)\b/)
  if (!match) return null
  const qty = parseInt(match[1])
  return qty > 1 && qty <= 20 ? qty : null
}

function parseDate(str) {
  if (!str) return null
  return str.split('T')[0] // "2026-05-27T04:00:00+00:00" → "2026-05-27"
}

// ─── FLIPP SEARCH API ──────────────────────────────────────
async function searchFlippItems(query) {
  const url = `https://cdn-gateflipp.flippback.com/bf/flipp/items/search?locale=en-us&postal_code=${POSTAL_CODE}&sid=&q=${encodeURIComponent(query)}`
  try {
    const res = await fetch(url, {
      headers: {
        'accept':          '*/*',
        'origin':          'https://flipp.com',
        'referer':         'https://flipp.com/',
        'user-agent':      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        'dnt':             '1',
      }
    })
    if (!res.ok) {
      console.warn(`[flipp-sweep] HTTP ${res.status} for "${query}"`)
      return []
    }
    const data = await res.json()
    // Only return flyer items — skip ecom_items (JCPenney etc)
    return (data?.items || []).filter(i => i.item_type === 'flyer')
  } catch (err) {
    console.warn(`[flipp-sweep] Fetch error for "${query}": ${err.message}`)
    return []
  }
}

// ─── MAIN ──────────────────────────────────────────────────
async function main() {
  console.log('[flipp-sweep] ════════════════════════════════')
  console.log(`[flipp-sweep] Starting — ${new Date().toISOString()}`)
  console.log(`[flipp-sweep] Terms: ${SEARCH_TERMS.length}`)
  console.log('[flipp-sweep] ════════════════════════════════\n')

  const seen     = new Set() // dedupe by flyer_item_id + store_id
  const toInsert = []

  for (const term of SEARCH_TERMS) {
    await sleep(DELAY_MS)

    const items = await searchFlippItems(term)
    let termCount = 0

    for (const item of items) {
      const storeIds = resolveStoreIds(item.merchant_name)
      if (!storeIds.length) continue

      const price = parsePrice(item.current_price)
      const name  = item.name?.trim()
      if (!name || price === null) continue

      for (const store_id of storeIds) {
        const dedupKey = `${item.flyer_item_id}_${store_id}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)

        toInsert.push({
          // core
          barcode:          item.sku || null,
          product_name:     name,
          store_id,
          price,
          source:           'flipp',
          // dates
          valid_from:       parseDate(item.valid_from),
          valid_to:         parseDate(item.valid_to),
          // promo
          regular_price:    parsePrice(item.original_price),
          promo_description: item.sale_story   || null,
          pre_price_text:   item.pre_price_text || null,
          post_price_text:  item.post_price_text || null,
          promo_min_qty:    parseMinQty(item.sale_story || item.pre_price_text),
          // merchant + flyer
          merchant_name:    item.merchant_name  || null,
          flyer_id:         item.flyer_id        || null,
          flyer_item_id:    item.flyer_item_id   || null,
          // category
          category_l1:      item._L1             || null,
          category_l2:      item._L2             || null,
          // image
          clean_image_url:  item.clean_image_url || null,
          // legacy fields
          unit:             null,
          sale_type:        item.item_type        || null,
        })
        termCount++
      }
    }

    console.log(`[flipp-sweep]   "${term}" → ${termCount} items`)
  }

  if (toInsert.length === 0) {
    console.log('[flipp-sweep] No items to insert.')
    return
  }

  console.log(`\n[flipp-sweep] Writing ${toInsert.length} items to flipp_observations...`)

  // Clear stale records
  const today = new Date().toISOString().split('T')[0]
  const { error: deleteError } = await supabase
    .from('flipp_observations')
    .delete()
    .lt('valid_to', today)

  if (deleteError) {
    console.warn('[flipp-sweep] Could not clear stale records:', deleteError.message)
  } else {
    console.log('[flipp-sweep] Stale records cleared')
  }

  // Insert in chunks
  let inserted = 0
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk     = toInsert.slice(i, i + CHUNK)
    const { error } = await supabase.from('flipp_observations').insert(chunk)
    if (error) {
      console.error('[flipp-sweep] Batch insert error:', error.message)
    } else {
      inserted += chunk.length
    }
  }

  console.log('\n[flipp-sweep] ════════════════════════════════')
  console.log(`[flipp-sweep] Complete — ${new Date().toISOString()}`)
  console.log(`[flipp-sweep]   Items written: ${inserted}`)
  console.log('[flipp-sweep] ════════════════════════════════\n')
}

main().catch(err => {
  console.error('[flipp-sweep] FATAL:', err)
  process.exit(1)
})
