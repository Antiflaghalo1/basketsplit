#!/usr/bin/env node
'use strict';

const { createClient } = require('@supabase/supabase-js');

// ─── CONFIG ────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SEARCH_API = 'https://api-dxpro.mercatus.com/gateway/product/v2.0/api/search';
const OFFERS_API = 'https://api-dxpro.mercatus.com/gateway/dxp-core/v1.0/api/Offer/GetOfferInfosByUpcs';
const TENANT_ID  = '10016';

const IE_STORES = [
  { storeCode: '184', dbId: 'staters_chino_schaefer_ave',      city: 'Chino — Schaefer Ave'       },
  { storeCode: '209', dbId: 'staters_chino_pine_ave',           city: 'Chino — Pine Ave'            },
  { storeCode: '052', dbId: 'staters_chino_riverside_dr',       city: 'Chino — Riverside Dr'        },
  { storeCode: '169', dbId: 'staters_chinohills',               city: 'Chino Hills — Chino Hills Pkwy' },
  { storeCode: '085', dbId: 'staters_ontario_4th_st',           city: 'Ontario — 4th St'            },
  { storeCode: '208', dbId: 'staters_ontario_haven_ave',        city: 'Ontario — Haven Ave'         },
  { storeCode: '108', dbId: 'staters_ontario_holt_blvd',        city: 'Ontario — Holt Blvd'         },
  { storeCode: '204', dbId: 'staters_ontario_ontario_ranch_rd', city: 'Ontario — Ontario Ranch Rd'  },
  { storeCode: '059', dbId: 'staters_ontario_philadelphia_st',  city: 'Ontario — Philadelphia St'   },
];

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
];

const PAGE_SIZE = 30;
const MAX_PAGES = 10;
const DELAY_MS  = 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── TOKEN ─────────────────────────────────────────────────
// Launches headless Chromium via Playwright.
// Passes Cloudflare naturally (real browser), intercepts the
// outgoing Mercatus API request and pulls the Bearer token.
// Falls back to STATER_TOKEN env var if set (manual override).
async function getGuestToken() {
  if (process.env.STATER_TOKEN) {
    console.log('[stater-sweep] ✅ Using token from STATER_TOKEN env');
    return process.env.STATER_TOKEN;
  }

  console.log('[stater-sweep] Launching headless browser to fetch token...');

  const { chromium } = require('playwright');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let token = null;

  // Intercept every outgoing request — grab Bearer token when Mercatus fires
  page.on('request', request => {
    if (request.url().includes('api-dxpro.mercatus.com')) {
      const auth = request.headers()['authorization'];
      if (auth?.startsWith('Bearer ')) {
        token = auth.replace('Bearer ', '');
      }
    }
  });

  // Navigate to search — triggers the Mercatus API call naturally
  await page.goto('https://www.staterbros.com/en/groceries/search?kw=eggs', {
    waitUntil: 'networkidle',
    timeout:   45000,
  });

  await browser.close();

  if (!token) throw new Error('Browser loaded but token not captured — Cloudflare may have intervened');

  console.log('[stater-sweep] ✅ Token extracted via browser');
  return token;
}

// ─── SEARCH ────────────────────────────────────────────────
async function searchProducts(token, storeCode, keyword, page = 1) {
  try {
    const res = await fetch(SEARCH_API, {
      method: 'POST',
      headers: {
        'accept':         '*/*',
        'authorization':  `Bearer ${token}`,
        'content-type':   'application/json',
        'tenantidentify': TENANT_ID,
        'user-agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'origin':         'https://www.staterbros.com',
        'referer':        'https://www.staterbros.com/',
        'dnt':            '1',
      },
      body: JSON.stringify({
        keyword,
        language:                   'en',
        categories:                 [],
        brands:                     [],
        featured:                   [],
        minPrice:                   0,
        maxPrice:                   0,
        sortBy:                     '',
        order:                      '',
        promotions:                 [],
        departments:                [],
        dietaryInterest:            [],
        ebtEligibility:             null,
        availableOnline:            true,
        isOnSale:                   false,
        page,
        pageSize:                   PAGE_SIZE,
        optimizeQueriesEnabled:     true,
        spellCheckEnabled:          true,
        storeCode,
        UserProductRecommendations: [],
      }),
    });

    if (res.status === 401) throw new Error('Token expired or invalid');
    if (!res.ok) {
      console.warn(`[stater-sweep] Search HTTP ${res.status} for "${keyword}"`);
      return { products: [], totalPages: 0 };
    }

    const data       = await res.json();
    const records    = data?.Data?.Records;
    const products   = records?.[0]?.Results || [];
    const totalPages = data?.Data?.TotalPages || 0;

    return { products, totalPages };
  } catch (err) {
    console.warn(`[stater-sweep] Search error "${keyword}": ${err.message}`);
    return { products: [], totalPages: 0 };
  }
}

// ─── OFFERS ────────────────────────────────────────────────
async function getOffers(token, storeCode, upcs) {
  if (!upcs.length) return {};
  try {
    const res = await fetch(OFFERS_API, {
      method: 'POST',
      headers: {
        'accept':         '*/*',
        'authorization':  `Bearer ${token}`,
        'content-type':   'application/json',
        'tenantidentify': TENANT_ID,
        'user-agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'origin':         'https://www.staterbros.com',
        'referer':        'https://www.staterbros.com/',
        'dnt':            '1',
      },
      body: JSON.stringify({ upcs, storeCode }),
    });

    if (!res.ok) return {};

    const data     = await res.json();
    const offerMap = {};
    const offers   = data?.Data || data?.offers || data || [];

    if (Array.isArray(offers)) {
      for (const offer of offers) {
        const upc       = offer.Upc || offer.upc || offer.productCode;
        const salePrice = offer.SalePrice || offer.salePrice || offer.offerPrice;
        if (upc && salePrice) offerMap[upc] = parseFloat(salePrice);
      }
    }
    return offerMap;
  } catch (err) {
    console.warn(`[stater-sweep] Offers error: ${err.message}`);
    return {};
  }
}

// ─── ITEM EXTRACTION ───────────────────────────────────────
function extractItem(product) {
  const upc   = product.Gtin;
  const name  = product.Title?.en || product.DisplayName?.en;
  const price = product.Price;

  if (!upc || !name || !price) return null;

  return {
    upc,
    name,
    brand:    product.Brand?.Name?.en || null,
    imageUrl: product.Images?.[0]?.Large || null,
    price:    parseFloat(price),
    category: product.Categories?.Level1?.Name?.en || null,
  };
}

// ─── SUPABASE WRITES ───────────────────────────────────────
async function upsertProduct(item) {
  const { error } = await supabase.from('products').upsert({
    upc:             item.upc,
    name:            item.name,
    brand:           item.brand || null,
    image_url:       item.imageUrl || null,
    raw_category:    item.category || null,
    name_source:     'stater_sweep',
    last_scanned_at: new Date().toISOString(),
  }, { onConflict: 'upc' });
  if (error) console.error(`[stater-sweep] Product error: ${error.message}`);
  return !error;
}

async function insertObservation(item, dbStoreId, salePrice) {
  const finalPrice = salePrice ?? item.price;
  const { error }  = await supabase.from('observations').insert({
    barcode:      item.upc,
    product_name: item.name,
    store_id:     dbStoreId,
    price:        finalPrice,
    voided:       false,
  });
  if (error && !error.message?.includes('duplicate')) {
    console.error(`[stater-sweep] Observation error: ${error.message}`);
    return false;
  }
  await supabase.from('price_history').insert({
    barcode:     item.upc,
    store_id:    dbStoreId,
    price:       finalPrice,
    source:      'stater_sweep',
    recorded_at: new Date().toISOString(),
  });
  return true;
}

// ─── MAIN ──────────────────────────────────────────────────
async function main() {
  console.log('\n[stater-sweep] ════════════════════════════════');
  console.log(`[stater-sweep] Starting — ${new Date().toISOString()}`);
  console.log(`[stater-sweep] Stores: ${IE_STORES.length}`);
  console.log(`[stater-sweep] Terms:  ${SEARCH_TERMS.length}`);
  console.log('[stater-sweep] ════════════════════════════════\n');

  const token = await getGuestToken();

  // Phase 1: Sweep catalog once using first store
  console.log('[stater-sweep] Phase 1 — Sweeping product catalog...\n');

  const allItems = new Map();

  for (const term of SEARCH_TERMS) {
    await sleep(DELAY_MS);
    let page      = 1;
    let termCount = 0;

    while (true) {
      const { products, totalPages } = await searchProducts(token, IE_STORES[0].storeCode, term, page);
      if (!products.length) break;

      for (const product of products) {
        const item = extractItem(product);
        if (!item) continue;
        if (!allItems.has(item.upc)) {
          allItems.set(item.upc, item);
          termCount++;
        }
      }

      if (page >= totalPages || page >= MAX_PAGES) break;
      page++;
      await sleep(DELAY_MS);
    }

    console.log(`[stater-sweep]   "${term}" → ${termCount} new`);
  }

  console.log(`\n[stater-sweep] Catalog: ${allItems.size} unique products`);

  // Phase 2: Per store — sale prices + Supabase writes
  console.log('\n[stater-sweep] Phase 2 — Writing per store to Supabase...\n');

  let totalProducts = 0;
  let totalObs      = 0;
  const upcs        = [...allItems.keys()];

  for (const store of IE_STORES) {
    console.log(`[stater-sweep] → ${store.city}`);

    const offerMap = {};
    for (let i = 0; i < upcs.length; i += 30) {
      const batch       = upcs.slice(i, i + 30);
      const batchOffers = await getOffers(token, store.storeCode, batch);
      Object.assign(offerMap, batchOffers);
      await sleep(500);
    }

    for (const item of allItems.values()) {
      const didProduct = await upsertProduct(item);
      if (didProduct) totalProducts++;

      const salePrice = offerMap[item.upc] ?? null;
      const didObs    = await insertObservation(item, store.dbId, salePrice);
      if (didObs) totalObs++;
    }

    console.log(`[stater-sweep]   ✅ ${store.city} done`);
    await sleep(DELAY_MS);
  }

  console.log('\n[stater-sweep] ════════════════════════════════');
  console.log(`[stater-sweep] Complete — ${new Date().toISOString()}`);
  console.log(`[stater-sweep]   Products upserted:     ${totalProducts}`);
  console.log(`[stater-sweep]   Observations inserted: ${totalObs}`);
  console.log('[stater-sweep] ════════════════════════════════\n');
}

main().catch(err => {
  console.error('[stater-sweep] FATAL:', err);
  process.exit(1);
});
