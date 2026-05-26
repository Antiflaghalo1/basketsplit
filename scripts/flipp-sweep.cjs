const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  realtime: { transport: ws }
})

const ZIP_CODES = ['91710', '91709', '91761']

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

function resolveStoreIds(merchantName) {
  return STORE_MAP[merchantName.toLowerCase().trim()] || []
}

function parsePrice(priceStr) {
  if (!priceStr) return null
  const match = String(priceStr).match(/[\d.]+/)
  if (!match) return null
  const price = parseFloat(match[0])
  return isNaN(price) || price <= 0 || price > 500 ? null : price
}

async function main() {
  console.log('BasketSplit Flipp Sweep starting...')
  console.log('Zip codes: ' + ZIP_CODES.join(', '))

  const seen = new Set()
  const toInsert = []

  for (const zip of ZIP_CODES) {
    console.log('\nFetching flyers for ' + zip + '...')

    let flyerData
    try {
      flyerData = await getFlyers(zip)
    } catch (err) {
      console.warn('Could not fetch flyers for ' + zip + ': ' + err.message)
      continue
    }

    const flyers = flyerData && flyerData.flyers ? flyerData.flyers : []
    console.log('Found ' + flyers.length + ' total flyers')

    const relevantFlyers = flyers.filter(f => resolveStoreIds(f.merchant).length > 0)
    console.log(relevantFlyers.length + ' match our store list')

    for (const flyer of relevantFlyers) {
      const storeIds = resolveStoreIds(flyer.merchant)
      const flyerId = flyer.id

      if (seen.has(flyerId)) {
        console.log('Skipping duplicate flyer: ' + flyer.merchant)
        continue
      }
      seen.add(flyerId)

      console.log('Processing ' + flyer.merchant + ' -> ' + storeIds.join(', '))

      let items
      try {
        await new Promise(r => setTimeout(r, 500))
        items = await getFlyerItems(flyerId)
      } catch (err) {
        console.warn('Could not fetch items for ' + flyer.merchant + ': ' + err.message)
        continue
      }

      let itemCount = 0
      for (const item of items) {
        const price = parsePrice(item.current_price || item.price)
        const name = item.name && item.name.trim()
        if (!name || price === null) continue

        for (const store_id of storeIds) {
          toInsert.push({
            barcode: item.sku || null,
            product_name: name,
            store_id,
            price,
            unit: item.unit_price_value || null,
            sale_type: item.sale_story || null,
            valid_from: item.valid_from || flyer.valid_from || null,
            valid_to: item.valid_to || flyer.valid_to || null,
            source: 'flipp',
          })
        }
        itemCount++
      }
      console.log(itemCount + ' valid items')
    }
  }

  if (toInsert.length === 0) {
    console.log('No items to insert.')
    return
  }

  console.log('\nWriting ' + toInsert.length + ' items to flipp_observations...')

  const today = new Date().toISOString().split('T')[0]
  const { error: deleteError } = await supabase
    .from('flipp_observations')
    .delete()
    .lt('valid_to', today)

  if (deleteError) {
    console.warn('Could not clear stale records:', deleteError.message)
  } else {
    console.log('Stale records cleared')
  }

  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK)
    const { error } = await supabase.from('flipp_observations').insert(chunk)
    if (error) {
      console.error('Batch insert error:', error.message)
    } else {
      inserted += chunk.length
    }
  }

  console.log('Sweep complete - ' + inserted + ' items written to flipp_observations')
}

main().catch(err => {
  console.error('Scraper crashed:', err)
  process.exit(1)
})
