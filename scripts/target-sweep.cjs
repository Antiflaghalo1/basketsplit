#!/usr/bin/env node
'use strict';

const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');

// ─── CONFIG ────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { realtime: { transport: ws } }
);

const TARGET_KEY  = '9f36aeafbe60771e321a7cc95a78140772ab3e96';
const VISITOR_ID  = '019C257D75070200A35590C672CA3F1C';

// All IE Target store IDs mapped to Supabase store IDs
const IE_STORES = [
  { storeId: '912',  dbId: 'target_chino_grand_ave',           name: 'Chino Grand Ave',       zip: '91710', lat: 34.003217, lng: -117.718361, state: 'CA' },
  { storeId: '258',  dbId: 'target_chino_philadelphia_st',      name: 'Chino Philadelphia St',  zip: '91710', lat: 34.034017, lng: -117.681100, state: 'CA' },
  { storeId: '2499', dbId: 'target_murrieta_clinton_keith_rd',  name: 'Murrieta Clinton Keith', zip: '92562', lat: 33.604062, lng: -117.172938, state: 'CA' },
  { storeId: '1283', dbId: 'target_murrieta_south',             name: 'Murrieta South',         zip: '92562', lat: 33.565938, lng: -117.203063, state: 'CA' },
  { storeId: '2245', dbId: 'target_ontario_main',               name: 'Ontario Main',           zip: '91764', lat: 34.075563, lng: -117.561688, state: 'CA' },
  { storeId: '3446', dbId: 'target_ontario_north',              name: 'Ontario North',          zip: '91764', lat: 34.076313, lng: -117.618313, state: 'CA' },
];

// All purchasable store IDs in a single string for the API
const ALL_STORE_IDS = IE_STORES.map(s => s.storeId).join(',');

const SEARCH_TERMS = [
  'eggs', 'milk', 'butter', 'cheese', 'yogurt',
  'chicken', 'ground beef', 'beef', 'pork', 'salmon', 'shrimp',
  'bacon', 'sausage', 'turkey',
  'bread', 'tortillas', 'rice', 'pasta', 'cereal', 'oatmeal',
  'olive oil', 'cooking oil', 'sugar', 'flour',
  'canned beans', 'canned tomatoes', 'soup',
  'orange juice', 'water', 'coffee',
  'potatoes', 'onions', 'apples', 'bananas', 'avocado',
  'snacks', 'chips',
  'laundry detergent', 'paper towels', 'toilet paper', 'trash bags',
  'diapers', 'dish soap',
];

const DELAY_MS  = 1500;
const PAGE_SIZE = 24;
const MAX_PAGES = 5    // up to 120 products per term
const CHUNK     = 500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── HELPERS ───────────────────────────────────────────────
function decodeHtml(str) {
  return (str || '').replace(/&#38;/g, '&').replace(/&#8482;/g, '™').replace(/&amp;/g, '&').replace(/&trade;/g, '™');
}

function normalizeCat(raw) {
  if (!raw) return 'Miscellaneous';
  const c = raw.toLowerCase();
  if (/egg/.test(c))                                                    return 'Dairy & Eggs';
  if (/milk|dairy|cheese|butter|yogurt|cream/.test(c))                 return 'Dairy & Eggs';
  if (/meat|poultry|seafood|beef|chicken|pork|fish|shrimp|bacon|sausage|turkey/.test(c)) return 'Meat & Seafood';
  if (/produce|vegetable|fruit|fresh/.test(c))                         return 'Produce';
  if (/bread|bakery|baked/.test(c))                                    return 'Bakery & Bread';
  if (/beverage|juice|water|coffee|tea|drink|soda/.test(c))            return 'Beverages';
  if (/cereal|breakfast|oatmeal/.test(c))                              return 'Breakfast & Cereal';
  if (/snack|chip|cracker|candy|cookie/.test(c))                       return 'Snacks & Candy';
  if (/frozen/.test(c))                                                return 'Frozen Foods';
  if (/pasta|rice|grain|flour|sugar|oil|sauce|soup|canned|condiment/.test(c)) return 'Pantry & Canned';
  if (/cleaning|laundry|paper|trash|household/.test(c))                return 'Household & Cleaning';
  if (/baby|diaper|infant/.test(c))                                    return 'Baby & Kids';
  if (/pet/.test(c))                                                   return 'Pet Care';
  if (/health|beauty|personal/.test(c))                               return 'Health & Beauty';
  return 'Miscellaneous';
}

function extractItem(product) {
  const tcin  = product?.tcin;
  const name  = decodeHtml(product?.item?.product_description?.title);
  const price = product?.price?.current_retail;

  if (!tcin || !name || !price) return null;

  const rawCat = product?.item?.product_classification?.item_type?.name || null;

  return {
    upc:      `target_${tcin}`,
    name,
    brand:    product?.item?.primary_brand?.name || null,
    price:    parseFloat(price),
    wasPrice: product?.price?.display_was_now ? product?.price?.reg_retail : null,
    unitPrice: product?.price?.formatted_unit_price || null,
    imageUrl: product?.item?.enrichment?.image_info?.primary_image?.url || null,
    rawCat,
  };
}

// ─── SEARCH — single call gets products + prices ────────────
async function searchProducts(page, store, term, offset) {
  try {
    const data = await page.evaluate(async ({ key, visitorId, term, store, allStores, offset, pageSize }) => {
      const params = new URLSearchParams({
        key,
        platform: 'WEB',
        sapphire_channel: 'WEB',
        sapphire_page: `/s/${term}`,
        channel: 'WEB',
        page: `/s/${term}`,
        visitor_id: visitorId,
        purchasable_store_ids: allStores,
        latitude: store.lat,
        longitude: store.lng,
        scheduled_delivery_store_id: store.storeId,
        scheduled_delivery_zip_code: store.zip,
        state: store.state,
        store_id: store.storeId,
        zip: store.zip,
        has_pending_inputs: false,
        count: pageSize,
        offset,
        default_purchasability_filter: true,
        include_sponsored: false,
        new_search: offset === 0,
        spellcheck: true,
        store_ids: allStores,
        keyword: term,
        is_seo_bot: false,
        include_data_source_modules: true,
        query_string: `searchTerm=${term}`,
        timezone: 'America/Los_Angeles',
      });

      const resp = await fetch(
        `https://cdui-orchestrations.target.com/cdui_orchestrations/v1/pages/slp?${params}`,
        { headers: { accept: 'application/json' } }
      );
      return await resp.json();
    }, { key: TARGET_KEY, visitorId: VISITOR_ID, term, store, allStores: ALL_STORE_IDS, offset, pageSize: PAGE_SIZE });

    const sr       = data?.data_source_modules?.[0]?.module_data?.search_response;
    const products = sr?.products || [];
    const meta     = sr?.search_response?.metadata || {};
    const total    = meta.total_results || 0;
    const pages    = meta.total_pages || 1;

    return { products, total, pages };
  } catch (err) {
    console.warn(`[target-sweep] Search error "${term}" offset ${offset}: ${err.message}`);
    return { products: [], total: 0, pages: 0 };
  }
}

// ─── SUPABASE WRITES ───────────────────────────────────────
async function batchWrite(storeItems, dbStoreId) {
  const now  = new Date().toISOString();
  const prods = [], obs = [], hist = [];

  for (const item of storeItems.values()) {
    prods.push({
      upc:                 item.upc,
      name:                item.name,
      brand:               item.brand || null,
      image_url:           item.imageUrl || null,
      raw_category:        item.rawCat || null,
      normalized_category: normalizeCat(item.rawCat),
      name_source:         'target_sweep',
      last_scanned_at:     now,
    });
    obs.push({
      barcode:      item.upc,
      product_name: item.name,
      store_id:     dbStoreId,
      price:        item.price,
      voided:       false,
    });
    hist.push({
      barcode:     item.upc,
      store_id:    dbStoreId,
      price:       item.price,
      source:      'target_sweep',
      recorded_at: now,
    });
  }

  for (let i = 0; i < prods.length; i += CHUNK) {
    const { error } = await supabase.from('products').upsert(prods.slice(i, i + CHUNK), { onConflict: 'upc' });
    if (error) console.error(`[target-sweep] Products error: ${error.message}`);
  }
  for (let i = 0; i < obs.length; i += CHUNK) {
    const { error } = await supabase.from('observations').upsert(obs.slice(i, i + CHUNK), { onConflict: 'barcode,store_id' });
    if (error) console.error(`[target-sweep] Observations error: ${error.message}`);
  }
  for (let i = 0; i < hist.length; i += CHUNK) {
    const { error } = await supabase.from('price_history').insert(hist.slice(i, i + CHUNK));
    if (error) console.error(`[target-sweep] Price history error: ${error.message}`);
  }

  return prods.length;
}

// ─── MAIN ──────────────────────────────────────────────────
async function main() {
  console.log('\n[target-sweep] ════════════════════════════════');
  console.log(`[target-sweep] Starting — ${new Date().toISOString()}`);
  console.log(`[target-sweep] Stores: ${IE_STORES.length}`);
  console.log(`[target-sweep] Terms:  ${SEARCH_TERMS.length}`);
  console.log('[target-sweep] ════════════════════════════════\n');

  const browser = await chromium.launch({ headless: true });
  let totalProducts = 0, totalObs = 0;

  for (const store of IE_STORES) {
    console.log(`\n[target-sweep] → ${store.name} (store ${store.storeId})`);

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Warm up — PerimeterX sets _px2 on initial page load
    console.log('[target-sweep]   Warming session...');
    await page.goto('https://www.target.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Set store cookie
    await context.addCookies([{
      name: 'fiatsCookie',
      value: `DSI_${store.storeId}|DSN_${store.name}|DSZ_${store.zip}`,
      domain: '.target.com',
      path: '/',
    }]);

    const storeItems = new Map();

    for (const term of SEARCH_TERMS) {
      await sleep(DELAY_MS);
      let termCount = 0;

      for (let p = 0; p < MAX_PAGES; p++) {
        const offset = p * PAGE_SIZE;
        const { products, total, pages } = await searchProducts(page, store, term, offset);

        if (!products.length) break;

        for (const raw of products) {
          const item = extractItem(raw);
          if (!item) continue;
          if (!storeItems.has(item.upc)) {
            storeItems.set(item.upc, item);
            termCount++;
          }
        }

        if (offset + PAGE_SIZE >= total || p + 1 >= pages) break;
        await sleep(DELAY_MS);
      }

      console.log(`[target-sweep]   "${term}" → ${termCount} new`);
    }

    console.log(`[target-sweep]   Catalog: ${storeItems.size} unique products`);
    const written  = await batchWrite(storeItems, store.dbId);
    totalProducts += written;
    totalObs      += storeItems.size;
    console.log(`[target-sweep]   ✅ ${store.name} done`);

    await context.close();
  }

  await browser.close();

  console.log('\n[target-sweep] ════════════════════════════════');
  console.log(`[target-sweep] Complete — ${new Date().toISOString()}`);
  console.log(`[target-sweep]   Products upserted:     ${totalProducts}`);
  console.log(`[target-sweep]   Observations upserted: ${totalObs}`);
  console.log('[target-sweep] ════════════════════════════════\n');
}

main().catch(err => {
  console.error('[target-sweep] FATAL:', err);
  process.exit(1);
});
