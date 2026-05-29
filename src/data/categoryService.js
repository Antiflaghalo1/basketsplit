import { supabase } from '../lib/supabase';

export async function fetchAttributeGroups() {
  console.warn('[categoryService] fetchAttributeGroups is deprecated. Use fetchSubcategoryDrill.');
  return [];
}

export async function fetchGroupResults() {
  console.warn('[categoryService] fetchGroupResults is deprecated. Use fetchSubcategoryDrill.');
  return [];
}

function dedupeObservationsByBarcodeStore(observations) {
  // Keep newest observation per (barcode, store_id) pair.
  // Input observations should already be sorted by created_at desc;
  // the first occurrence of a key wins.
  const map = new Map();
  for (const obs of observations || []) {
    const key = `${obs.barcode}|${obs.store_id}`;
    if (!map.has(key)) map.set(key, obs);
  }
  return Array.from(map.values());
}

export async function fetchUntaggedItems(normalizedCategory) {
  const { data: allProducts } = await supabase
    .from('products')
    .select('upc, name, brand, image_url, subcategory, variant, size_grade, package, attributes')
    .eq('normalized_category', normalizedCategory);

  if (!allProducts || allProducts.length === 0) return [];

  const untagged = (allProducts || []).filter(p =>
    !p.subcategory || !p.variant || !p.size_grade || !p.package
  );

  if (untagged.length === 0) return [];

  const upcList = untagged.map(p => p.upc);

  const { data: observations } = await supabase
    .from('observations')
    .select('id, barcode, price, store_id, created_at')
    .in('barcode', upcList)
    .eq('voided', false)
    .limit(10000)
    .order('created_at', { ascending: false });

  const newestPerPair = new Map();
  for (const obs of observations ?? []) {
    const key = `${obs.barcode}|${obs.store_id}`;
    if (!newestPerPair.has(key)) {
      newestPerPair.set(key, obs);
    }
  }

  const uniqueStoreIds = [...new Set(
    Array.from(newestPerPair.values()).map(o => o.store_id)
  )];

  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, location, city, color')
    .in('id', uniqueStoreIds);

  const storeMap = {};
  for (const store of stores ?? []) {
    storeMap[store.id] = store;
  }

  const results = [];

  for (const product of untagged) {
    const productObs = Array.from(newestPerPair.values()).filter(
      o => o.barcode === product.upc
    );
    if (productObs.length === 0) continue;

    const best = productObs.reduce((a, b) => a.price < b.price ? a : b);

    results.push({
      upc: product.upc,
      productName: product.name,
      brand: product.brand,
      imageUrl: product.image_url || null,
      lowestPrice: Number(best.price).toFixed(2),
      store: storeMap[best.store_id] || null,
      createdAt: best.created_at,
      observationCount: productObs.length,
    });
  }

  return results.sort((a, b) => a.lowestPrice - b.lowestPrice);
}

export async function fetchDepartmentBrowse(normalizedCategory) {
  const { data: allProducts } = await supabase
    .from('products')
    .select('upc, subcategory, image_url, variant, size_grade, package, attributes')
    .eq('normalized_category', normalizedCategory);

  if (!allProducts) return { subcategories: [], untaggedCount: 0 };

  const tagged = (allProducts || []).filter(p =>
    p.subcategory && p.variant && p.size_grade && p.package
  );
  const untaggedCount = allProducts.length - tagged.length;

  const taggedUpcs = tagged.map(p => p.upc);
  if (taggedUpcs.length === 0) return { subcategories: [], untaggedCount };

  const { data: obs } = await supabase
    .from('observations')
    .select('barcode, price, created_at')
    .in('barcode', taggedUpcs)
    .eq('voided', false)
    .order('created_at', { ascending: false });

  const latestObs = {};
  for (const o of obs ?? []) {
    if (!latestObs[o.barcode]) {
      latestObs[o.barcode] = o;
    }
  }

  const groups = {};
  for (const product of tagged) {
    const o = latestObs[product.upc];
    if (!o) continue;

    if (!groups[product.subcategory]) {
      groups[product.subcategory] = {
        key: product.subcategory,
        productCount: 0,
        lowestPrice: Infinity,
        imageUrl: null,
      };
    }

    const g = groups[product.subcategory];
    g.productCount += 1;

    if (o.price < g.lowestPrice) {
      g.lowestPrice = o.price;
      g.imageUrl = product.image_url;
    }
  }

  const subcategories = Object.values(groups)
    .filter(g => g.lowestPrice !== Infinity)
    .sort((a, b) => a.lowestPrice - b.lowestPrice)
    .map(g => ({
      key: g.key,
      productCount: g.productCount,
      lowestPrice: Number(g.lowestPrice).toFixed(2),
      imageUrl: g.imageUrl,
    }));

  return { subcategories, untaggedCount };
}

export async function fetchSubcategoryDrill(normalizedCategory, subcategory, filters) {
  // STEP 0 — Normalize filters
  const safeFilters = {
    attributes: [],
    variant: null,
    size_grade: null,
    package: null,
    ...(filters || {})
  };
  safeFilters.attributes = Array.isArray(safeFilters.attributes)
    ? safeFilters.attributes
    : [];

  // STEP 1 — Fetch schema
  const { data: schemaRow } = await supabase
    .from('category_schemas')
    .select('schema')
    .eq('subcategory', subcategory)
    .maybeSingle();
  if (!schemaRow) return null;
  const schema = schemaRow.schema;

  // STEP 2 — Build drill order from schema
  const drillOrder = Object.entries(schema)
    .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99))
    .map(([key, def]) => ({ key, def }));

  // STEP 3 — Find next unfilled dimension
  const nextDim = drillOrder.find(({ key }) => {
    if (key === 'attributes') {
      return safeFilters.attributes.length === 0;
    }
    return !safeFilters[key];
  }) || null;

  // STEP 4 — Fetch products matching current filters
  let q = supabase
    .from('products')
    .select('upc, name, brand, image_url, subcategory, variant, size_grade, package, attributes')
    .eq('normalized_category', normalizedCategory)
    .eq('subcategory', subcategory);
  if (safeFilters.variant)    q = q.eq('variant',    safeFilters.variant);
  if (safeFilters.size_grade) q = q.eq('size_grade', safeFilters.size_grade);
  if (safeFilters.package)    q = q.eq('package',    safeFilters.package);
  const { data: rawProducts } = await q;
  let products = rawProducts || [];

  if (safeFilters.attributes.length > 0) {
    products = products.filter(p =>
      safeFilters.attributes.every(attr => {
        if (attr === 'conventional') {
          // 'Conventional' = no qualifier attributes set.
          // Empty array is the canonical conventional state; we also accept
          // an explicit 'conventional' string for robustness.
          return !p.attributes
            || p.attributes.length === 0
            || p.attributes.includes('conventional');
        }
        return Array.isArray(p.attributes) && p.attributes.includes(attr);
      })
    );
  }

  // STEP 5 — Fetch observations for the filtered products in one batch
  const upcs = products.map(p => p.upc);
  let observations = [];
  if (upcs.length > 0) {
    const { data: obs } = await supabase
      .from('observations')
      .select('id, barcode, price, store_id, created_at, promo_type')
      .in('barcode', upcs)
      .eq('voided', false)
      .order('created_at', { ascending: false });
    observations = obs || [];
  }

  // STEP 5b — Build deduped observations ONCE.
  // This is critical for price consistency between option tiles and leaf cards.
  const dedupedObservations = dedupeObservationsByBarcodeStore(observations);

  // STEP 6 — If nextDim exists, build schema-driven options
  if (nextDim) {
    const options = nextDim.def.options.map(opt => {
      const matchingProducts = products.filter(p => {
        if (nextDim.key === 'attributes') {
          if (opt.value === 'conventional') {
            return !p.attributes
              || p.attributes.length === 0
              || p.attributes.includes('conventional');
          }
          return Array.isArray(p.attributes) && p.attributes.includes(opt.value);
        }
        return p[nextDim.key] === opt.value;
      });

      const matchingUpcs = new Set(matchingProducts.map(p => p.upc));
      const matchingObs = dedupedObservations.filter(o => matchingUpcs.has(o.barcode));

      let lowestPrice = Infinity;
      let lowestProduct = null;
      const storeIds = new Set();
      for (const o of matchingObs) {
        storeIds.add(o.store_id);
        const priceNum = Number(o.price);
        if (priceNum < lowestPrice) {
          lowestPrice = priceNum;
          lowestProduct = matchingProducts.find(p => p.upc === o.barcode);
        }
      }

      let unitPrice = null, unitLabel = null;
      if (lowestProduct && lowestProduct.package && lowestPrice !== Infinity) {
        const m = lowestProduct.package.match(/^(\d+)_ct$/);
        if (m) {
          const ct = Number(m[1]);
          if (ct > 0) {
            unitPrice = parseFloat((lowestPrice / ct).toFixed(4));
            unitLabel = 'per unit';
          }
        }
      }

      return {
        value: opt.value,
        label: opt.label,
        productCount: matchingProducts.length,
        storeCount: storeIds.size,
        lowestPrice: lowestPrice !== Infinity
          ? Number(lowestPrice).toFixed(2)
          : null,
        unitPrice,
        unitLabel
      };
    });

    return {
      schema,
      nextDimension: { key: nextDim.key, def: nextDim.def },
      options,
      productResults: []
    };
  }

  // STEP 7 — All dimensions filled; build productResults
  const uniqueStoreIds = [...new Set(dedupedObservations.map(o => o.store_id))];
  let storeMap = {};
  if (uniqueStoreIds.length > 0) {
    const { data: stores } = await supabase
      .from('stores')
      .select('id, name, location, city, color')
      .in('id', uniqueStoreIds);
    for (const s of (stores || [])) storeMap[s.id] = s;
  }

  const productResults = [];
  for (const obs of dedupedObservations) {
    const prod = products.find(p => p.upc === obs.barcode);
    if (!prod) continue;

    let unitPrice = null, unitLabel = null;
    if (prod.package) {
      const m = prod.package.match(/^(\d+)_ct$/);
      if (m) {
        const ct = Number(m[1]);
        if (ct > 0) {
          unitPrice = parseFloat((Number(obs.price) / ct).toFixed(4));
          unitLabel = 'per unit';
        }
      }
    }

    productResults.push({
      id: obs.id,
      barcode: obs.barcode,
      productName: prod.name,
      brand: prod.brand,
      imageUrl: prod.image_url || null,
      price: Number(obs.price).toFixed(2),
      unitPrice,
      unitLabel,
      store: storeMap[obs.store_id] || null,
      createdAt: obs.created_at,
      promoType: obs.promo_type
    });
  }

  productResults.sort((a, b) => Number(a.price) - Number(b.price));

  return {
    schema,
    nextDimension: null,
    options: [],
    productResults
  };
}
