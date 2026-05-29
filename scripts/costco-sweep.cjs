#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────
// costco-sweep.cjs
// Uses Costco's public LucidWorks search API.
// x-api-key is embedded in their public JS — no session needed.
// No bot detection, no HTML parsing, pure clean REST JSON.
//
// Runs weekly via GitHub Actions.
// NOTE: Add more IE warehouse IDs as we discover them.
//       All currently use warehouse 847 (Temecula) pricing.
// ─────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── CONFIG ────────────────────────────────────────────────

const SEARCH_BASE =
  'https://search.costco.com/api/apps/www_costco_com/query/www_costco_com_search';

// Public API key embedded in Costco's frontend JS bundle
const API_KEY = '273db6be-f015-4de7-b0d6-dd4746ccd5c3';

// Warehouse 847 = Temecula, covers IE pricing
// The loc string is the full distribution center list for that area
const WAREHOUSE_847_LOC = [
  '847_0-cor','847_0-cwt','847_0-edi','847_0-ehs','847_0-membership',
  '847_0-mpt','847_0-spc','847_0-wm','847_1-cwt','847_1-edi',
  '847_NA-cor','847_NA-pharmacy','847_NA-wm','953-wm','952-wm',
].join(',');

// IE Costco stores — all use warehouse 847 pricing
const IE_STORES = [
  { dbId: 'costco_temecula',         city: 'Temecula'          },
  { dbId: 'costco_chinohills',       city: 'Chino Hills'       },
  { dbId: 'costco_rancho_cucamonga', city: 'Rancho Cucamonga'  },
  { dbId: 'costco_murrieta',         city: 'Murrieta'          },
];

const SEARCH_TERMS = [
  // Dairy & Eggs
  'eggs', 'milk', 'butter', 'cheese', 'yogurt', 'cream',
  // Meat
  'chicken', 'ground beef', 'beef', 'pork', 'salmon', 'shrimp',
  'bacon', 'sausage', 'hot dogs', 'turkey',
  // Bakery & Pantry
  'bread', 'tortillas', 'rice', 'pasta', 'cereal', 'oatmeal',
  'olive oil', 'cooking oil', 'sugar', 'flour',
  'canned beans', 'canned tomatoes', 'soup',
  // Beverages
  'orange juice', 'water', 'coffee',
  // Produce
  'potatoes', 'onions', 'apples', 'bananas', 'avocado',
  // Household
  'diapers', 'laundry detergent', 'paper towels', 'toilet paper', 'trash bags',
  // Snacks
  'snacks', 'chips',
];

const ROWS_PER_PAGE = 24;
const DELAY_BETWEEN_SEARCHES = 1500;
const DELAY_BETWEEN_PAGES = 800;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

// ─── HELPERS ───────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function searchHeaders() {
  return {
    'accept':       'application/json',
    'content-type': 'application/json',
    'x-api-key':    API_KEY,
    'origin':       'https://www.costco.com',
    'referer':      'https://www.costco.com/',
    'user-agent':   USER_AGENT,
    'dnt':          '1',
  };
}

// ─── SEARCH ────────────────────────────────────────────────

async function searchCostco(term, start = 0) {
  const params = new URLSearchParams({
    q:            term,
    locale:       'en-US',
    start:        String(start),
    rows:         String(ROWS_PER_PAGE),
    userLocation: 'CA',
    loc:          WAREHOUSE_847_LOC,
    whloc:        '847-wh',
    expand:       'false',
    chdcategory:  'true',
    chdheader:    'true',
  });

  try {
    const res = await fetch(`${SEARCH_BASE}?${params}`, { headers: searchHeaders() });
    if (res.status === 429) {
      console.warn('[costco-sweep] Rate limited — sleeping 20s');
      await sleep(20000);
      return { docs: [], total: 0 };
    }
    if (!res.ok) {
      console.warn(`[costco-sweep] HTTP ${res.status} for "${term}" start=${start}`);
      return { docs: [], total: 0 };
    }
    const data = await res.json();
    return {
      docs:  data?.response?.docs  || [],
      total: data?.response?.numFound || 0,
    };
  } catch (err) {
    console.warn(`[costco-sweep] Fetch error: ${err.message}`);
    return { docs: [], total: 0 };
  }
}

// ─── ITEM EXTRACTION ───────────────────────────────────────

function extractItem(doc) {
  const rawNumber = doc.item_number || '';
  const itemNumber = rawNumber.split('!')[0];
  if (!itemNumber) return null;

  const price =
    doc.item_location_pricing_salePrice ||
    doc.minSalePrice ||
    null;
  if (!price || parseFloat(price) <= 0) return null;

  const name = doc.item_display_name || doc.item_name || null;
  if (!name) return null;

  return {
    upc:      `costco_${itemNumber}`,
    name,
    brand:    doc.item_brand || null,
    imageUrl: doc.item_collateral_primaryimage || null,
    price:    parseFloat(price),
  };
}

// ─── SUPABASE ──────────────────────────────────────────────

async function upsertProduct(item) {
  const { error } = await supabase
    .from('products')
    .upsert({
      upc:             item.upc,
      name:            item.name,
      brand:           item.brand || null,
      image_url:       item.imageUrl || null,
      name_source:     'costco_sweep',
      last_scanned_at: new Date().toISOString(),
    }, { onConflict: 'upc' });
  if (error) console.error(`[costco-sweep] Product error: ${error.message}`);
  return !error;
}

async function insertObservation(item, dbStoreId) {
  const { error } = await supabase
    .from('observations')
    .insert({
      barcode:      item.upc,
      product_name: item.name,
      store_id:     dbStoreId,
      price:        item.price,
      voided:       false,
    });
  if (error && !error.message?.includes('duplicate')) {
    console.error(`[costco-sweep] Observation error: ${error.message}`);
    return false;
  }
  await supabase.from('price_history').insert({
    barcode:     item.upc,
    store_id:    dbStoreId,
    price:       item.price,
    source:      'costco_sweep',
    recorded_at: new Date().toISOString(),
  });
  return true;
}

// ─── MAIN ──────────────────────────────────────────────────

async function main() {
  console.log(`\n[costco-sweep] ════════════════════════════════`);
  console.log(`[costco-sweep] Starting — ${new Date().toISOString()}`);
  console.log(`[costco-sweep] Stores: ${IE_STORES.length}`);
  console.log(`[costco-sweep] Terms:  ${SEARCH_TERMS.length}`);
  console.log(`[costco-sweep] ════════════════════════════════\n`);

  // Phase 1: Sweep product catalog from search API (one pass, not per store)
  console.log('[costco-sweep] Phase 1 — Sweeping product catalog...\n');

  const allItems = new Map(); // upc → item

  for (const term of SEARCH_TERMS) {
    await sleep(DELAY_BETWEEN_SEARCHES);

    let start = 0;
    let totalFound = 0;
    let termCount = 0;

    while (true) {
      const { docs, total } = await searchCostco(term, start);
      if (start === 0) totalFound = total;
      if (!docs.length) break;

      for (const doc of docs) {
        const item = extractItem(doc);
        if (!item) continue;
        if (!allItems.has(item.upc)) {
          allItems.set(item.upc, item);
          termCount++;
        }
      }

      start += ROWS_PER_PAGE;
      if (start >= totalFound || start >= 200) break; // cap at 200 per term
      await sleep(DELAY_BETWEEN_PAGES);
    }

    console.log(`[costco-sweep]   "${term}" → ${totalFound} found, ${termCount} new`);
  }

  console.log(`\n[costco-sweep] Catalog: ${allItems.size} unique products`);

  // Phase 2: Write products + one observation per IE store
  console.log('\n[costco-sweep] Phase 2 — Writing to Supabase...\n');

  let totalProducts = 0;
  let totalObs = 0;

  for (const item of allItems.values()) {
    const didProduct = await upsertProduct(item);
    if (didProduct) totalProducts++;

    // Insert an observation for each IE store (same Costco price across stores)
    for (const store of IE_STORES) {
      const didObs = await insertObservation(item, store.dbId);
      if (didObs) totalObs++;
    }
  }

  console.log(`\n[costco-sweep] ════════════════════════════════`);
  console.log(`[costco-sweep] Complete — ${new Date().toISOString()}`);
  console.log(`[costco-sweep]   Products upserted:     ${totalProducts}`);
  console.log(`[costco-sweep]   Observations inserted: ${totalObs}`);
  console.log(`[costco-sweep] ════════════════════════════════\n`);
}

main().catch(err => {
  console.error('[costco-sweep] FATAL:', err);
  process.exit(1);
});
