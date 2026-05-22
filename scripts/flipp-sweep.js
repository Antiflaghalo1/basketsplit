/**
 * BasketSplit — Flipp Circular Scraper
 * Runs weekly via GitHub Actions
 * Writes to flipp_observations table (separate from community observations)
 */

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

// IE zip codes to cover all store locations
const ZIP_CODES = ['91710', '91709', '91761']

// Map Flipp merchant names → our store IDs
const STORE_MAP = {
  'walmart':                  'walmart',
  'stater bros':              'stater',
  'stater bros markets':      'stater',
  'food 4 less':              'food4less',
  'aldi':                     'aldi',
  'sprouts':                  'sprouts',
  'sprouts farmers market':   'sprouts',
  'cardenas':                 'cardenas',
  'cardenas markets':         'cardenas',
  'northgate':                'northgate',
  'northgate gonzález':       'northgate',
  'northgate gonzalez':       'northgate',
  'target':                   'target',
}

function generateSid() {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('')
}

async function getFlyers(zip) {
  const sid = generateSid()
  const url = `https://flyers-ng.flippback.com/api/flipp/data?locale=en&postal_code=${zip}&sid=${sid}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BasketSplitBot/1.0)' }
  })
  if (!res.ok) throw new Error(`Flipp flyers fetch failed: ${res.status}`)
  return res.json()
}

async function getFlyerItems(flyerId) {
  const sid = generateSid()
  const url = `https://flyers-ng.flippback.com/api/flipp/flyers/${flyerId}/flyer_items?locale=en&sid=${sid}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BasketSplitBot/1.0)' }
  })
  if (!res.ok) throw new Error(`Flipp items fetch failed for flyer ${flyerId}: ${res.status}`)
  return res.json()
}

function resolveStoreId(merchantName) {
  return STORE_MAP[merchantName.toLowerCase().trim()] || null
}

function parsePrice(priceStr) {
  if (!priceStr) return null
  // Handle ranges like "2 for $5.00" — take the unit price
  const match = String(priceStr).match(/[\d.]+/)
  if (!match) return null
  const price = parseFloat(match[0])
  return isNaN(price) || price <= 0 || price > 500 ? null : price
}

async function main() {
  console.log('🐿️  BasketSplit Flipp Sweep starting...')
  console.log(`Zip codes: ${ZIP_CODES.join(', ')}`)

  const seen = new Set() // deduplicate across zip codes
  const toInsert = []

  for (const zip of ZIP_CODES) {
    console.log(`\n📍 Fetching flyers for ${zip}...`)

    let flyerData
    try {
      flyerData = await getFlyers(zip)
    } catch (err) {
      console.warn(`  ⚠️  Could not fetch flyers for ${zip}: ${err.message}`)
      continue
    }

    const flyers = flyerData?.flyers || []
    console.log(`  Found ${flyers.length} total flyers`)

    // Filter to known IE stores
    const relevantFlyers = flyers.filter(f => resolveStoreId(f.merchant))
    console.log(`  ${relevantFlyers.length} match our store list`)

    for (const flyer of relevantFlyers) {
      const storeId = resolveStoreId(flyer.merchant)
      const flyerId = flyer.id

      // Skip if already processed this flyer from another zip
      if (seen.has(flyerId)) {
        console.log(`  ↩️  Skipping duplicate flyer: ${flyer.merchant} (${flyerId})`)
        continue
      }
      seen.add(flyerId)

      console.log(`  🛒 Processing ${flyer.merchant} → store_id: ${storeId}`)

      let items
      try {
        // Be polite — small delay between requests
        await new Promise(r => setTimeout(r, 500))
        items = await getFlyerItems(flyerId)
      } catch (err) {
        console.warn(`    ⚠️  Could not fetch items for ${flyer.merchant}: ${err.message}`)
        continue
      }

      let itemCount = 0
      for (const item of items) {
        const price = parsePrice(item.current_price || item.price)
        const name = item.name?.trim()
        if (!name || price === null) continue

        toInsert.push({
          barcode: item.sku || null,
          product_name: name,
          store_id: storeId,
          price,
          unit: item.unit_price_value || null,
          sale_type: item.sale_story || null,
          valid_from: item.valid_from || flyer.valid_from || null,
          valid_to: item.valid_to || flyer.valid_to || null,
          source: 'flipp',
        })
        itemCount++
      }
      console.log(`    ✅ ${itemCount} valid items`)
    }
  }

  if (toInsert.length === 0) {
    console.log('\n⚠️  No items to insert.')
    return
  }

  console.log(`\n💾 Writing ${toInsert.length} items to flipp_observations...`)

  // Clear stale records (valid_to in the past) before inserting fresh ones
  const today = new Date().toISOString().split('T')[0]
  const { error: deleteError } = await supabase
    .from('flipp_observations')
    .delete()
    .lt('valid_to', today)

  if (deleteError) {
    console.warn('⚠️  Could not clear stale records:', deleteError.message)
  } else {
    console.log('🗑️  Stale records cleared')
  }

  // Batch insert in chunks of 500
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK)
    const { error } = await supabase.from('flipp_observations').insert(chunk)
    if (error) {
      console.error(`❌ Batch insert error (chunk ${i / CHUNK + 1}):`, error.message)
    } else {
      inserted += chunk.length
    }
  }

  console.log(`\n✅ Sweep complete — ${inserted} items written to flipp_observations`)
}

main().catch(err => {
  console.error('💥 Scraper crashed:', err)
  process.exit(1)
})
