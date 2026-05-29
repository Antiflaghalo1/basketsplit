#!/usr/bin/env node
'use strict';

const { createClient } = require('@supabase/supabase-js');

// ─── CONFIG ────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const KROGER_CLIENT_ID     = process.env.KROGER_CLIENT_ID;
const KROGER_CLIENT_SECRET = process.env.KROGER_CLIENT_SECRET;
const KROGER_API           = 'https://api.kroger.com/v1';

// IE zip codes to search for stores
const IE_ZIPS = ['91710', '91761', '91764'];

// Kroger banner chains to sweep
const CHAINS = ['RALPHS', 'FOOD4LESS'];

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
];

const DELAY_MS = 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── AUTH ──────────────────────────────────────────────────
// Kroger uses OAuth2 client credentials — token lasts 30 minutes
let cachedToken    = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  console.log('[kroger-sweep] Fetching OAuth token...');
  const creds = Buffer.from(`${KROGER_CLIENT_ID}:${KROGER_CLIENT_SECRET}`).toString('base64');

  const res = await fetch(`${KROGER_API}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: 'grant_type=client_credentials&scope=product.compact',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token fetch failed: ${res.status} — ${err}`);
  }

  const data      = await res.json();
  cachedToken     = data.access_token;
  tokenExpiresAt  = Date.now() + (data.expires_in * 1000);

  console.log('[kroger-sweep] ✅ Token acquired');
  return cachedToken;
}

// ─── LOCATIONS ─────────────────────────────────────────────
async function findStores(token, chain, zipCode) {
  try {
    const url = `${KROGER_API}/locations?filter.chain=${chain}&filter.zipCode.near=${zipCode}&filter.radiusInMiles=20&filter.limit=10`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (err) {
    console.warn(`[kroger-sweep] Location search error: ${err.message}`);
    return [];
  }
}

// ─── PRODUCTS ──────────────────────────────────────────────
async function searchProducts(token, locationId, term, start = 0) {
  try {
    const url = `${KROGER_API}/products?filter.term=${encodeURIComponent(term)}&filter.locationId=${locationId}&filter.limit=50&filter.start=${start}&filter.fulfillment=ais`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    if (!res.ok) {
      console.warn(`[kroger-sweep] Products HTTP ${res.status} for "${term}"`);
      return { products: [], total: 0 };
    }
    const data = await res.json();
    return {
      products: data.data || [],
      total:    data.meta?.pagination?.total || 0,
    };
  } catch (err) {
    console.warn(`[kroger-sweep] Products error "${term}": ${err.message}`);
    return { products: [], total: 0 };
  }
}

// ─── ITEM EXTRACTION ───────────────────────────────────────
function extractItem(product, locationId) {
  const upc   = product.upc;
  const name  = product.description;
  const item  = product.items?.[0];
  const price = item?.price?.regular ?? item?.price?.promo ?? null;

  if (!upc || !name || !price) return null;

  return {
    upc:        upc.padStart(13, '0'),
    name,
    brand:      product.brand || null,
    imageUrl:   product.images?.find(i => i.perspective === 'front')?.sizes?.find(s => s.size === 'medium')?.url || null,
    price:      parseFloat(price),
    salePrice:  item?.price?.promo ? parseFloat(item.price.promo) : null,
    category:   product.categories?.[0] || null,
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
    name_source:     'kroger_sweep',
    last_scanned_at: new Date().toISOString(),
  }, { onConflict: 'upc' });
  if (error) console.error(`[kroger-sweep] Product error: ${error.message}`);
  return !error;
}

async function insertObservation(item, dbStoreId) {
  const finalPrice = item.salePrice ?? item.price;
  const { error } = await supabase.from('observations').insert({
    barcode:      item.upc,
    product_name: item.name,
    store_id:     dbStoreId,
    price:        finalPrice,
    voided:       false,
  });
  if (error && !error.message?.includes('duplicate')) {
    console.error(`[kroger-sweep] Observation error: ${error.message}`);
    return false;
  }
  await supabase.from('price_history').insert({
    barcode:     item.upc,
    store_id:    dbStoreId,
    price:       finalPrice,
    source:      'kroger_sweep',
    recorded_at: new Date().toISOString(),
  });
  return true;
}

// ─── STORE ID MAPPING ──────────────────────────────────────
// Maps Kroger locationId to your Supabase store id
// We'll discover and log stores on first run so you can add them
function buildDbStoreId(chain, store) {
  const city    = (store.address?.city || '').toLowerCase().replace(/\s+/g, '_')
  const street  = (store.address?.addressLine1 || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  const chainId = chain.toLowerCase()
  return `${chainId}_${city}_${street.slice(0, 20)}`
}

// ─── MAIN ──────────────────────────────────────────────────
async function main() {
  console.log('\n[kroger-sweep] ════════════════════════════════');
  console.log(`[kroger-sweep] Starting — ${new Date().toISOString()}`);
  console.log(`[kroger-sweep] Chains: ${CHAINS.join(', ')}`);
  console.log(`[kroger-sweep] Terms:  ${SEARCH_TERMS.length}`);
  console.log('[kroger-sweep] ════════════════════════════════\n');

  const token = await getToken();

  // Phase 1: Discover IE stores
  console.log('[kroger-sweep] Phase 1 — Discovering IE stores...\n');

  const storeMap = new Map(); // locationId → { dbStoreId, chain, name }
  const seenLocations = new Set();

  for (const chain of CHAINS) {
    for (const zip of IE_ZIPS) {
      const stores = await findStores(token, chain, zip);
      for (const store of stores) {
        if (seenLocations.has(store.locationId)) continue;
        seenLocations.add(store.locationId);

        const dbStoreId = buildDbStoreId(chain, store);
        storeMap.set(store.locationId, {
          dbStoreId,
          chain,
          name: store.name,
          address: `${store.address?.addressLine1}, ${store.address?.city}`,
        });

        console.log(`[kroger-sweep]   ${chain} | ${store.name} | ${store.address?.addressLine1}, ${store.address?.city}`);
        console.log(`[kroger-sweep]   locationId: ${store.locationId} → dbStoreId: ${dbStoreId}`);
      }
      await sleep(500);
    }
  }

  console.log(`\n[kroger-sweep] Found ${storeMap.size} unique IE stores\n`);

  if (storeMap.size === 0) {
    console.error('[kroger-sweep] No stores found — check chain names and zip codes');
    return;
  }

  // Phase 2: Sweep products per store
  console.log('[kroger-sweep] Phase 2 — Sweeping products...\n');

  let totalProducts = 0;
  let totalObs      = 0;

  for (const [locationId, storeInfo] of storeMap) {
    console.log(`\n[kroger-sweep] → ${storeInfo.chain} | ${storeInfo.name}`);

    const storeItems = new Map(); // upc → item

    for (const term of SEARCH_TERMS) {
      await sleep(DELAY_MS);
      let termCount = 0;
      let start     = 0;

      while (true) {
        const { products, total } = await searchProducts(token, locationId, term, start);
        if (!products.length) break;

        for (const product of products) {
          const item = extractItem(product, locationId);
          if (!item) continue;
          if (!storeItems.has(item.upc)) {
            storeItems.set(item.upc, item);
            termCount++;
          }
        }

        start += 50;
        if (start >= total || start >= 200) break; // cap at 200 per term
        await sleep(DELAY_MS);
      }

      console.log(`[kroger-sweep]   "${term}" → ${termCount} new`);
    }

    console.log(`[kroger-sweep]   Catalog: ${storeItems.size} unique products`);

    // Write to Supabase
    for (const item of storeItems.values()) {
      const didProduct = await upsertProduct(item);
      if (didProduct) totalProducts++;

      const didObs = await insertObservation(item, storeInfo.dbStoreId);
      if (didObs) totalObs++;
    }

    console.log(`[kroger-sweep]   ✅ ${storeInfo.name} done`);
  }

  console.log('\n[kroger-sweep] ════════════════════════════════');
  console.log(`[kroger-sweep] Complete — ${new Date().toISOString()}`);
  console.log(`[kroger-sweep]   Products upserted:     ${totalProducts}`);
  console.log(`[kroger-sweep]   Observations inserted: ${totalObs}`);
  console.log('[kroger-sweep] ════════════════════════════════\n');
}

main().catch(err => {
  console.error('[kroger-sweep] FATAL:', err);
  process.exit(1);
});
