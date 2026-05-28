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
const DELAY_MS  = 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── TOKEN ─────────────────────────────────────────────────
async function getGuestToken() {
  console.log('[stater-sweep] Fetching guest token...');

  const res = await fetch('https://www.staterbros.com/en', {
    headers: {
      'user-agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.5',
      'dnt':             '1',
    },
  });

  if (!res.ok) throw new Error(`Page fetch failed: ${res.status}`);

  const html = await res.text();

  // Try: JWT directly in HTML
  const jwtMatch = html.match(/"accessToken"\s*:\s*"(eyJ[^"]+)"/);
  if (jwtMatch) {
    console.log('[stater-sweep] ✅ Token found in HTML');
    return jwtMatch[1];
  }

  // Try: Next.js __NEXT_DATA__ embedded JSON
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const pp = nextData?.props?.pageProps;
      const token =
        pp?.accessToken   ||
        pp?.token         ||
        pp?.bearerToken   ||
        pp?.mercatusToken ||
        nextData?.props?.initialState?.auth?.token ||
        nextData?.props?.initialState?.accessToken;

      if (token) {
        console.log('[stater-sweep] ✅ Token found in __NEXT_DATA__');
        return token;
      }

      console.log('[stater-sweep] __NEXT_DATA__ top keys:', Object.keys(nextData || {}));
      console.log('[stater-sweep] pageProps keys:', Object.keys(pp || {}));
    } catch (e) {
      console.warn('[stater-sweep] Could not parse __NEXT_DATA__:', e.message);
    }
  }

  console.error('[stater-sweep] ❌ Token not found. HTML snippet:');
  console.error(html.substring(0, 3000));
  throw new Error('Token extraction failed — check HTML above to debug');
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
        'user-agent':     'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
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
      return { products: [] };
    }

    const data = await res.json();

    if (page === 1 && Object.keys(data).length) {
      console.log('[stater-sweep] Search response keys:', Object.keys(data));
    }

    return {
      products: data?.products || data?.items || data?.data?.products || [],
    };
  } catch (err) {
    console.warn(`[stater-sweep] Search error "${keyword}": ${err.message}`);
    return { products: [] };
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
        'user-agent':     'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'origin':         'https://www.staterbros.com',
        'referer':        'https://www.staterbros.com/',
        'dnt':            '1',
      },
      body: JSON.stringify({ upcs, storeCode }),
    });

    if (!res.ok) return {};

    const data = await res.json();
    const offerMap = {};
    const offers = data?.offers || data?.data || data || [];
    if (Array.isArray(offers)) {
      for (const offer of offers) {
        const upc       = offer.upc || offer.productCode || offer.code;
        const salePrice = offer.salePrice || offer.offerPrice || offer.price;
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
let loggedSample = false;
function extractItem(product) {
  if (!loggedSample) {
    console.log('[stater-sweep] Sample product keys:', Object.keys(product));
    loggedSample = true;
  }

  const upc   = product.upc || product.productCode || product.code || product.id;
  const name  = product.name || product.productName || product.displayName;
  const price = product.price || product.regularPrice || product.listPrice;

  if (!upc || !name || !price) return null;

  return {
    upc:      String(upc).replace(/\D/g, '').padStart(14, '0'),
    name,
    brand:    product.brand || product.brandName || null,
    imageUrl: product.imageUrl || product.image || product.thumbnailUrl || null,
    price:    parseFloat(price),
    category: product.category || product.departmentName || null,
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
  const { error } = await supabase.from('observations').insert({
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
    let page = 1;
    let termCount = 0;

    while (true) {
      const { products } = await searchProducts(token, IE_STORES[0].storeCode, term, page);
      if (!products.length) break;

      for (const product of products) {
        const item = extractItem(product);
        if (!item) continue;
        if (!allItems.has(item.upc)) {
          allItems.set(item.upc, item);
          termCount++;
        }
      }

      if (products.length < PAGE_SIZE) break;
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
