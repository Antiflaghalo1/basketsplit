#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────
// walmart-sweep.cjs
// Sweeps IE Walmart stores for grocery products + prices.
// Two-pass per item:
//   1. Search  → name, price, image, usItemId
//   2. ItemById → real UPC (falls back to wm_{usItemId} if blocked)
//
// Runs weekly via GitHub Actions after flipp-sweep.
// NOTE: ITEM_BY_ID_HASH will break when Walmart deploys a new
//       frontend build. Re-capture from DevTools → Network →
//       any 421705528?variables= call → copy URL hash segment.
// ─────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── CONFIG ────────────────────────────────────────────────

const ITEM_BY_ID_HASH =
  '742ce4e0a04711ca81b326cda3c3d064ee6de1c9be8e90751b6be3a0ecb24620';

// Walmart internal store ID → Supabase store ID
const STORE_MAP = [
  { walmartId: '3464', dbId: 'walmart_chino',    city: 'Chino'    },
  { walmartId: '3796', dbId: 'walmart_ontario',  city: 'Ontario'  },
  { walmartId: '2288', dbId: 'walmart_phillips_ranch', city: 'Phillips Ranch' },
  { walmartId: '3129', dbId: 'walmart_eastvale', city: 'Eastvale' },
];

const SEARCH_TERMS = [
  // Dairy & Eggs
  'eggs', 'milk', 'butter', 'cheese', 'yogurt', 'cream cheese',
  'sour cream', 'heavy cream', 'half and half',
  // Meat & Seafood
  'chicken breast', 'chicken thighs', 'ground beef', 'pork chops',
  'bacon', 'sausage', 'hot dogs', 'ground turkey', 'salmon',
  // Bakery
  'bread', 'tortillas', 'bagels', 'english muffins',
  // Pantry
  'rice', 'pasta', 'cereal', 'oatmeal', 'cooking oil', 'olive oil',
  'sugar', 'flour', 'canned beans', 'canned tomatoes', 'soup',
  // Beverages
  'orange juice', 'apple juice', 'water gallon',
  // Produce staples
  'potatoes', 'onions', 'apples', 'bananas', 'lettuce', 'tomatoes',
  'broccoli', 'carrots', 'avocado',
  // Household
  'diapers', 'laundry detergent', 'dish soap',
  'paper towels', 'toilet paper', 'trash bags',
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

// Delays (ms) — be respectful, avoid rate limits
const DELAY_BETWEEN_SEARCHES = 2500;
const DELAY_BETWEEN_ITEM_FETCHES = 800;

// ─── HEADERS ───────────────────────────────────────────────

function searchHeaders(walmartStoreId) {
  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'dnt': '1',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': USER_AGENT,
    // Minimal store context — no session cookies needed
    'cookie': `assortmentStoreId=${walmartStoreId}; _m=9; _shcc=US; hasLocData=1; _intlbu=false`,
  };
}

function itemHeaders(walmartStoreId, itemId) {
  return {
    'accept': 'application/json',
    'accept-language': 'en-US',
    'calltype': 'CLIENT',
    'content-type': 'application/json',
    'dnt': '1',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': USER_AGENT,
    'x-o-bu': 'WALMART-US',
    'x-o-ccm': 'server',
    'x-o-mart': 'B2C',
    'x-o-platform': 'rweb',
    'x-o-segment': 'oaoh',
    'x-apollo-operation-name': 'ItemById',
    'x-o-gql-query': 'query ItemById',
    'x-o-item-id': String(itemId),
    'cookie': `assortmentStoreId=${walmartStoreId}; _m=9; _shcc=US; hasLocData=1; _intlbu=false`,
  };
}

// ─── FETCH HELPERS ─────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeFetch(url, headers) {
  try {
    const res = await fetch(url, { headers });

    if (res.status === 429) {
      console.warn('[walmart-sweep] Rate limited (429) — sleeping 30s');
      await sleep(30000);
      return null;
    }
    if (!res.ok) {
      console.warn(`[walmart-sweep] HTTP ${res.status} — ${url.slice(0, 80)}`);
      return null;
    }

    const text = await res.text();

    // Try direct JSON (XHR response path)
    try {
      return JSON.parse(text);
    } catch {
      // Fall back to __NEXT_DATA__ extraction from HTML
      const m = text.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
      );
      if (m) {
        try { return JSON.parse(m[1]); }
        catch { return null; }
      }
      return null;
    }
  } catch (err) {
    console.warn(`[walmart-sweep] Fetch error: ${err.message}`);
    return null;
  }
}

// ─── SEARCH ────────────────────────────────────────────────

async function searchProducts(term, walmartStoreId) {
  const url =
    `https://www.walmart.com/search?q=${encodeURIComponent(term)}` +
    `&store=${walmartStoreId}`;

  const data = await safeFetch(url, searchHeaders(walmartStoreId));
  if (!data) return [];

  // Path 1: XHR JSON response
  let stacks = data?.data?.search?.searchResult?.itemStacks;

  // Path 2: __NEXT_DATA__ HTML response
  if (!stacks) {
    stacks =
      data?.props?.pageProps?.initialData?.searchResult?.itemStacks;
  }

  if (!stacks) return [];

  return stacks
    .flatMap(s => s.itemsV2 || [])
    .filter(i => i?.__typename === 'Product');
}

// ─── UPC ENRICHMENT ────────────────────────────────────────

function buildItemUrl(itemId) {
  const vars = encodeURIComponent(JSON.stringify({
    isMobile: false,
    channel: 'WWW',
    version: 'v2',
    postProcessingVersion: 2,
    pageType: 'ItemPageGlobalDesktop',
    tenant: 'WM_GLASS',
    iId: String(itemId),
    fBB: true,
    fIdml: true,
    fSeo: true,
    fRev: false,
    fP13: false,
    fSId: true,
  }));
  return (
    `https://www.walmart.com/orchestra/pdp/graphql/ItemById/` +
    `${ITEM_BY_ID_HASH}/ip/${itemId}?variables=${vars}`
  );
}

async function fetchUPC(itemId, walmartStoreId) {
  const url = buildItemUrl(itemId);
  const data = await safeFetch(url, itemHeaders(walmartStoreId, itemId));
  if (!data) return null;

  const prod = data?.data?.product;
  if (!prod) return null;

  // Try known UPC locations in the ItemById response.
  // Log the first successful path so we can confirm and clean this up.
  const candidates = [
    prod?.upc,
    prod?.item?.product?.upc,
    prod?.primaryOffer?.upc,
    prod?.offers?.[0]?.upc,
    prod?.item?.upc,
  ];

  const upc = candidates.find(v => v && /^\d{10,14}$/.test(String(v)));
  return upc ? String(upc) : null;
}

// ─── SUPABASE ──────────────────────────────────────────────

async function upsertProduct(upc, name, brand, imageUrl) {
  const { error } = await supabase
    .from('products')
    .upsert(
      {
        upc,
        name,
        brand: brand || null,
        image_url: imageUrl || null,
        name_source: 'walmart_sweep',
        name_confidence: 'medium',
        last_scanned_at: new Date().toISOString(),
      },
      { onConflict: 'upc' }
    );
  if (error) console.error(`[walmart-sweep] Product upsert error: ${error.message}`);
  return !error;
}

async function insertObservation(upc, name, dbStoreId, price) {
  const { error } = await supabase
    .from('observations')
    .insert({
      barcode: upc,
      product_name: name,
      store_id: dbStoreId,
      price,
      voided: false,
    });
  // Ignore duplicate key errors — same product may appear across search terms
  if (error && !error.message?.includes('duplicate')) {
    console.error(`[walmart-sweep] Observation error: ${error.message}`);
    return false;
  }
  return true;
}

// ─── MAIN ──────────────────────────────────────────────────

async function main() {
  console.log(`\n[walmart-sweep] ════════════════════════════════`);
  console.log(`[walmart-sweep] Starting — ${new Date().toISOString()}`);
  console.log(`[walmart-sweep] Stores: ${STORE_MAP.length}`);
  console.log(`[walmart-sweep] Terms:  ${SEARCH_TERMS.length}`);
  console.log(`[walmart-sweep] ════════════════════════════════\n`);

  let totalProducts = 0;
  let totalObservations = 0;
  let totalRealUPCs = 0;
  let totalTempIds = 0;
  let totalSkipped = 0;

  for (const store of STORE_MAP) {
    console.log(`\n[walmart-sweep] ── ${store.city} (${store.walmartId}) ──`);

    for (const term of SEARCH_TERMS) {
      await sleep(DELAY_BETWEEN_SEARCHES);

      const items = await searchProducts(term, store.walmartId);

      if (!items.length) {
        console.log(`[walmart-sweep]   "${term}" → 0 results`);
        continue;
      }

      const inStock = items.filter(
        i => i.availabilityStatusV2?.value === 'IN_STOCK'
          && i.priceInfo?.currentPrice?.price
      );

      console.log(
        `[walmart-sweep]   "${term}" → ${items.length} results, ` +
        `${inStock.length} in stock with price`
      );

      for (const item of inStock) {
        const price    = item.priceInfo.currentPrice.price;
        const usItemId = item.usItemId;
        const name     = item.name;
        const brand    = item.brand || null;
        const imageUrl = item.imageInfo?.thumbnailUrl || null;
        const tempUpc  = `wm_${usItemId}`;

        // Check if this Walmart item is already in the DB
        const { data: existing } = await supabase
          .from('products')
          .select('upc')
          .eq('upc', tempUpc)
          .maybeSingle();

        let finalUpc;

        if (!existing) {
          // New item — attempt real UPC fetch
          await sleep(DELAY_BETWEEN_ITEM_FETCHES);
          const upc = await fetchUPC(usItemId, store.walmartId);

          if (upc) {
            finalUpc = upc;
            totalRealUPCs++;
            console.log(`    ✓ ${upc} — ${name.slice(0, 55)}`);
          } else {
            finalUpc = tempUpc;
            totalTempIds++;
            console.log(`    ○ ${tempUpc} — ${name.slice(0, 55)}`);
          }
        } else {
          // Already stored — reuse whatever UPC we have
          finalUpc = existing.upc;
        }

        const didProduct = await upsertProduct(finalUpc, name, brand, imageUrl);
        const didObs     = await insertObservation(finalUpc, name, store.dbId, price);

        if (didProduct) totalProducts++;
        if (didObs)     totalObservations++;
      }
    }
  }

  console.log(`\n[walmart-sweep] ════════════════════════════════`);
  console.log(`[walmart-sweep] Complete — ${new Date().toISOString()}`);
  console.log(`[walmart-sweep]   Products upserted:     ${totalProducts}`);
  console.log(`[walmart-sweep]   Observations inserted: ${totalObservations}`);
  console.log(`[walmart-sweep]   Real UPCs found:       ${totalRealUPCs}`);
  console.log(`[walmart-sweep]   Temp wm_ IDs used:     ${totalTempIds}`);
  console.log(`[walmart-sweep]   Skipped (no price):    ${totalSkipped}`);
  console.log(`[walmart-sweep] ════════════════════════════════\n`);
}

main().catch(err => {
  console.error('[walmart-sweep] FATAL:', err);
  process.exit(1);
});
