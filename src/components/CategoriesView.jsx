import { useEffect, useState } from 'react'
import { Heart, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getAllStores } from '../data/storeService'
import { getCustomStores } from '../data/customStores'
import { saveItem, removeSavedItem } from '../data/savedItems'
import ReportModal from './ReportModal'
import { fetchAttributeGroups, fetchGroupResults, fetchUntaggedItems, fetchDepartmentBrowse, fetchSubcategoryDrill } from '../data/categoryService'

const CAT_META = {
  'Meat & Seafood':        { emoji: '🥩', bg: '#FAECE7', dot: '#D85A30' },
  'Dairy & Eggs':          { emoji: '🥛', bg: '#E1F5EE', dot: '#1D9E75' },
  'Produce':               { emoji: '🥬', bg: '#EAF3DE', dot: '#639922' },
  'Bakery & Bread':        { emoji: '🥖', bg: '#FAEEDA', dot: '#BA7517' },
  'Pantry & Canned':       { emoji: '🥫', bg: '#FAECE7', dot: '#D85A30' },
  'Frozen':                { emoji: '🧊', bg: '#E6F1FB', dot: '#378ADD' },
  'Beverages':             { emoji: '🥤', bg: '#E6F1FB', dot: '#378ADD' },
  'Snacks & Candy':        { emoji: '🍿', bg: '#FBEAF0', dot: '#D4537E' },
  'Pet Care':              { emoji: '🐾', bg: '#F5F0E8', dot: '#8B6914' },
  'Health & Beauty':       { emoji: '🧴', bg: '#EEEDFE', dot: '#7F77DD' },
  'Household & Cleaning':  { emoji: '🧹', bg: '#F1EFE8', dot: '#888780' },
  'Baby & Kids':           { emoji: '👶', bg: '#FBEAF0', dot: '#D4537E' },
  'Breakfast & Cereal':    { emoji: '🥣', bg: '#FFF3E0', dot: '#E67E22' },
  'Deli & Prepared':       { emoji: '🥗', bg: '#FFF3E0', dot: '#E67E22' },
  'Miscellaneous':         { emoji: '🛒', bg: '#F1EFE8', dot: '#888780' },
}

const SUBCATEGORY_MAP = {
  'Dairy & Eggs': { normalizedCategory: 'Dairy & Eggs', subcategories: ['eggs', 'milk'] },
  'Bakery':       { normalizedCategory: 'Bakery',       subcategories: ['bread'] },
};

const SUBCATEGORY_DISPLAY = {
  'eggs':  { label: 'Eggs',  emoji: '🥚' },
  'milk':  { label: 'Milk',  emoji: '🥛' },
  'bread': { label: 'Bread', emoji: '🍞' },
};

function cardFreshness(products) {
  if (products.length === 0) return { dot: '#888780', label: 'No scans yet', color: '#888780' }
  const mostRecent = products[0]?.last_scanned_at
  if (!mostRecent) return { dot: '#888780', label: 'No scans yet', color: '#888780' }
  const days = (Date.now() - new Date(mostRecent).getTime()) / 86400000
  if (days <= 7)  return { dot: '#1D9E75', label: 'Fresh',  color: '#1D9E75' }
  if (days <= 30) return { dot: '#BA7517', label: 'Aging',  color: '#BA7517' }
  return { dot: '#888780', label: 'Stale', color: '#888780' }
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

function freshnessBadge(ts) {
  const days = (Date.now() - new Date(ts).getTime()) / 86400000
  if (days <= 7) return { label: '🟢 Fresh', cls: 'freshness-fresh' }
  if (days <= 30) return { label: '🟡 Aging', cls: 'freshness-aging' }
  return { label: '🔴 Stale', cls: 'freshness-stale' }
}

function formatDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CategoriesView({ onBack, userId, savedUpcs = new Set(), onItemSaved, onItemRemoved, resetKey = 0 }) {
  const [stores, setStores] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [obsMap, setObsMap] = useState({})
  const [expandedPrices, setExpandedPrices] = useState(new Set())
  const [reportTarget, setReportTarget] = useState(null)
  const [selectedDept, setSelectedDept] = useState(null)
  const [untaggedItems, setUntaggedItems] = useState([])
  const [selectedSubcategory, setSelectedSubcategory] = useState(null);
  const [filters, setFilters] = useState({
    attributes: [],
    variant: null,
    size_grade: null,
    package: null
  });
  const [browsingUntagged, setBrowsingUntagged] = useState(false);
  const [departmentBrowse, setDepartmentBrowse] = useState(null);
  const [drillData, setDrillData] = useState(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  const allStores = [...stores, ...getCustomStores()]

  function togglePrices(upc) {
    setExpandedPrices(prev => {
      const next = new Set(prev)
      if (next.has(upc)) next.delete(upc)
      else next.add(upc)
      return next
    })
  }

  useEffect(() => {
    getAllStores().then(setStores)
    load()
  }, [])

  useEffect(() => {
    if (!expanded) {
      setObsMap({})
      setExpandedPrices(new Set())
      return
    }
    loadGroupObs(expanded)
  }, [expanded])

  useEffect(() => {
    setSelectedDept(null);
    setSelectedSubcategory(null);
    setFilters({ attributes: [], variant: null, size_grade: null, package: null });
    setBrowsingUntagged(false);
    setDepartmentBrowse(null);
    setDrillData(null);
    setUntaggedItems([]);
    setBrowseLoading(false);
    if (typeof setExpanded === 'function') setExpanded(null);
  }, [resetKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedDept) {
        setDepartmentBrowse(null);
        setDrillData(null);
        setUntaggedItems([]);
        return;
      }
      setBrowseLoading(true);

      if (browsingUntagged) {
        const u = await fetchUntaggedItems(selectedDept.normalizedCategory);
        if (!cancelled) setUntaggedItems(u || []);
      } else if (selectedSubcategory) {
        const d = await fetchSubcategoryDrill(
          selectedDept.normalizedCategory,
          selectedSubcategory,
          filters
        );
        if (!cancelled) setDrillData(d);
      } else {
        const b = await fetchDepartmentBrowse(selectedDept.normalizedCategory);
        if (!cancelled) setDepartmentBrowse(b);
      }

      if (!cancelled) setBrowseLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedDept, selectedSubcategory, filters, browsingUntagged])

  function handleDeptClick(deptLabel) {
    const mapping = SUBCATEGORY_MAP[deptLabel];
    if (!mapping) return;
    setSelectedDept({ label: deptLabel, ...mapping });
    setSelectedSubcategory(null);
    setFilters({ attributes: [], variant: null, size_grade: null, package: null });
    setBrowsingUntagged(false);
    setDepartmentBrowse(null);
    setDrillData(null);
    setUntaggedItems([]);
  }

  function handleBack() {
    if (browsingUntagged) {
      setBrowsingUntagged(false);
      setUntaggedItems([]);
      return;
    }

    // If any filter is set, pop the LATEST one (by schema order)
    const schema = drillData?.schema;
    const anyFilterSet =
      filters.attributes.length > 0
      || filters.variant
      || filters.size_grade
      || filters.package;

    if (schema && anyFilterSet) {
      const sortedKeys = Object.entries(schema)
        .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99))
        .map(([k]) => k);

      // Walk reverse — pop the deepest filled dimension
      for (let i = sortedKeys.length - 1; i >= 0; i--) {
        const key = sortedKeys[i];
        if (key === 'attributes' && filters.attributes.length > 0) {
          setFilters(prev => ({ ...prev, attributes: [] }));
          return;
        }
        if (key !== 'attributes' && filters[key]) {
          setFilters(prev => ({ ...prev, [key]: null }));
          return;
        }
      }
    }

    if (selectedSubcategory) {
      setSelectedSubcategory(null);
      setFilters({ attributes: [], variant: null, size_grade: null, package: null });
      setDrillData(null);
      return;
    }

    // Back to Level 0
    setSelectedDept(null);
    setDepartmentBrowse(null);
    setExpanded(null);
  }

  function handleSubcategoryClick(subcategoryKey) {
    setBrowseLoading(true);
    setSelectedSubcategory(subcategoryKey);
    setFilters({ attributes: [], variant: null, size_grade: null, package: null });
    setDrillData(null);
  }

  function handleUntaggedTileClick() {
    setBrowsingUntagged(true);
    setUntaggedItems([]);
  }

  function handleAttributeValueClick(dimensionKey, value) {
    setBrowseLoading(true);
    setFilters(prev => {
      if (dimensionKey === 'attributes') {
        // V1 single-select stored as single-element array
        return { ...prev, attributes: [value] };
      }
      return { ...prev, [dimensionKey]: value };
    });
  }

  async function load() {
    setLoading(true)
    const { data: categoryData, error } = await supabase.rpc('get_category_counts')
    if (error) console.error('Category counts error:', error.message)

    if (!categoryData || categoryData.length === 0) {
      setGroups([])
      setLoading(false)
      return
    }

    const groupMap = {}
    for (const item of categoryData) {
      const key = item.normalized_category || 'Miscellaneous'
      groupMap[key] = { name: key, itemCount: item.count, products: [] }
    }

    setGroups(Object.values(groupMap).sort((a, b) => a.name.localeCompare(b.name)))
    setLoading(false)
  }

  async function loadGroupObs(groupName) {
    const group = groups.find(g => g.name === groupName)
    if (!group) return
    const upcs = group.products.map(p => String(p.upc))
    const today = new Date().toISOString().split('T')[0]

    const [{ data: obs }, { data: flippRows }] = await Promise.all([
      supabase
        .from('observations')
        .select('barcode, price, store_id, created_at')
        .in('barcode', upcs)
        .eq('voided', false),
      supabase
        .from('flipp_observations')
        .select('barcode, store_id, price, valid_to')
        .in('barcode', upcs)
        .gt('price', 0)
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .order('price', { ascending: true }),
    ])

    const obsByUpc = {}
    for (const o of obs || []) {
      if (!obsByUpc[o.barcode]) obsByUpc[o.barcode] = []
      obsByUpc[o.barcode].push(o)
    }

    const flippBestByUpc = {}
    for (const row of flippRows || []) {
      if (!flippBestByUpc[row.barcode]) {
        flippBestByUpc[row.barcode] = { price: row.price, valid_to: row.valid_to }
      }
    }

    const map = {}
    for (const upc of upcs) {
      const upcObs = obsByUpc[upc] || []
      const validObs = upcObs.filter(o => o.price > 0 && o.price <= 500)
      const avgPrice = validObs.length > 0
        ? validObs.reduce((sum, o) => sum + o.price, 0) / validObs.length
        : null
      const top3 = [...validObs].sort((a, b) => a.price - b.price).slice(0, 3)
      const storeCount = new Set(validObs.map(o => o.store_id)).size
      const flippBest = flippBestByUpc[upc]
      const communityLowest = top3[0]?.price
      const flippSale = (communityLowest != null && flippBest && flippBest.price < communityLowest)
        ? flippBest
        : null
      map[upc] = { avgPrice, top3, storeCount, flippSale }
    }
    setObsMap(map)
  }

  function buildBreadcrumb() {
    const parts = [selectedDept?.label];
    if (selectedSubcategory) {
      const display = SUBCATEGORY_DISPLAY[selectedSubcategory];
      parts.push(display?.label || selectedSubcategory);
    }
    if (drillData?.schema) {
      const schema = drillData.schema;
      const orderedDims = Object.entries(schema)
        .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99));

      for (const [key, def] of orderedDims) {
        if (key === 'attributes' && filters.attributes.length > 0) {
          for (const attrValue of filters.attributes) {
            const opt = (def.options || []).find(o => o.value === attrValue);
            parts.push(opt?.label || attrValue);
          }
        } else if (key !== 'attributes' && filters[key]) {
          const opt = (def.options || []).find(o => o.value === filters[key]);
          parts.push(opt?.label || filters[key]);
        }
      }
    }
    return parts.filter(Boolean).join(' › ');
  }

  const inDrill = !!selectedDept;
  const inLevel1 = inDrill && !selectedSubcategory && !browsingUntagged;
  const inUntaggedView = inDrill && browsingUntagged;

  if (expanded && !selectedDept) {
    const group = groups.find(g => g.name === expanded)
    return (
      <div className="categories-view">
        {reportTarget && (
          <ReportModal
            targetId={reportTarget.targetId}
            targetName={reportTarget.targetName}
            userId={userId}
            onClose={() => setReportTarget(null)}
          />
        )}
        <button className="back-btn" onClick={() => setExpanded(null)}>← Categories</button>
        <div className="categories-header">
          <h2 className="categories-title">{group.name}</h2>
          <p className="categories-sub">
            {group.products.length} product{group.products.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="recent-list">
          {group.products.map(item => {
            const intel = obsMap[String(item.upc)]
            const badge = freshnessBadge(item.last_scanned_at)
            const lowestEntry = intel?.top3?.[0]
            const lowestStore = lowestEntry
              ? allStores.find(s => s.id === lowestEntry.store_id)?.name || lowestEntry.store_id
              : null
            return (
              <div key={item.upc} className="recent-card">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="recent-thumb" />
                ) : (
                  <div className="recent-thumb recent-thumb-placeholder">🛒</div>
                )}
                <div className="recent-info">
                  <div className="recent-name">{item.name}</div>
                  {item.brand && <div className="recent-brand">{item.brand}</div>}
                  {item.category && <div className="recent-cat">{item.category}</div>}
                  {intel && intel.storeCount > 0 && lowestEntry && (
                    <div className="price-intel-row">
                      <div className="price-intel-main">
                        {intel.storeCount > 1
                          ? <span className="price-intel-store-count">From ${lowestEntry.price.toFixed(2)} across {intel.storeCount} stores</span>
                          : <span>From ${lowestEntry.price.toFixed(2)} at {lowestStore}</span>
                        }
                        <span className={`freshness-badge ${badge.cls}`}>{badge.label}</span>
                      </div>
                      {intel.flippSale && (
                        <div>
                          <span className="sale-badge">🏷️ Sale: ${intel.flippSale.price.toFixed(2)}</span>
                          {intel.flippSale.valid_to && (
                            <span className="sale-until"> until {formatDate(intel.flippSale.valid_to)}</span>
                          )}
                        </div>
                      )}
                      <button className="top3-toggle" onClick={() => togglePrices(item.upc)}>
                        {expandedPrices.has(item.upc) ? '▲ Hide' : '▼ Best prices'}
                      </button>
                      {expandedPrices.has(item.upc) && (
                        <div className="top3-list">
                          {intel.top3.map((entry, i) => {
                            const storeName = allStores.find(s => s.id === entry.store_id)?.name || entry.store_id
                            return (
                              <div key={i} className="top3-row">
                                ${entry.price.toFixed(2)} · {storeName} · {timeAgo(entry.created_at)}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="saved-action-row">
                    <button
                      className={savedUpcs.has(String(item.upc)) ? 'save-heart-btn save-heart-btn-saved' : 'save-heart-btn'}
                      onClick={() => {
                        const upc = String(item.upc)
                        if (savedUpcs.has(upc)) {
                          removeSavedItem(userId, upc)
                          onItemRemoved?.(upc)
                        } else {
                          saveItem(userId, item)
                          onItemSaved?.(item)
                        }
                      }}
                    >
                      {savedUpcs.has(String(item.upc))
                        ? <><Heart size={13} fill="currentColor" /> Saved</>
                        : <><Heart size={13} /> Save</>}
                    </button>
                    <button
                      className="save-heart-btn"
                      onClick={() => setReportTarget({ targetId: String(item.upc), targetName: item.name })}
                    >
                      <AlertTriangle size={13} /> Report
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="categories-view">
      {reportTarget && (
        <ReportModal
          targetId={reportTarget.targetId}
          targetName={reportTarget.targetName}
          userId={userId}
          onClose={() => setReportTarget(null)}
        />
      )}

      {inLevel1 && (
        <>
          <div className="drill-header">
            <button className="drill-back-btn" onClick={handleBack}>
              ‹ All categories
            </button>
            <h2 className="drill-title">{selectedDept.label}</h2>
          </div>
          {browseLoading && <div className="drill-loading">Loading…</div>}
          {!browseLoading && departmentBrowse && (
            <>
              {departmentBrowse.subcategories.map(sub => {
                const display = SUBCATEGORY_DISPLAY[sub.key] || { label: sub.key, emoji: '📦' };
                return (
                  <div key={sub.key} className="drill-tile-card"
                       onClick={() => handleSubcategoryClick(sub.key)}>
                    <div className="drill-tile-thumb">
                      <div className="drill-tile-placeholder">{display.emoji}</div>
                    </div>
                    <div className="drill-tile-info">
                      <div className="drill-tile-label">{display.label}</div>
                      <div className="drill-tile-meta">
                        {sub.productCount} product{sub.productCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="drill-tile-trailing">
                      <div className="drill-tile-price">from ${sub.lowestPrice}</div>
                    </div>
                    <span className="drill-tile-arrow">›</span>
                  </div>
                );
              })}
              {departmentBrowse.untaggedCount > 0 && (
                <div className="drill-tile-card needs-sorting-tile"
                     onClick={handleUntaggedTileClick}>
                  <div className="drill-tile-thumb">
                    <div className="drill-tile-placeholder">❓</div>
                  </div>
                  <div className="drill-tile-info">
                    <div className="drill-tile-label">Needs Sorting</div>
                    <div className="drill-tile-meta">
                      {departmentBrowse.untaggedCount} item{departmentBrowse.untaggedCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className="drill-tile-arrow">›</span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {inUntaggedView && (
        <>
          <div className="drill-header">
            <button className="drill-back-btn" onClick={handleBack}>
              ‹ {selectedDept.label}
            </button>
            <div className="drill-breadcrumb">{selectedDept.label} › Needs Sorting</div>
          </div>
          {browseLoading && <div className="drill-loading">Loading…</div>}
          {!browseLoading && untaggedItems.length === 0 && (
            <div className="drill-empty">No untagged items.</div>
          )}
          {!browseLoading && untaggedItems.map(item => (
            <div key={item.upc} className="untagged-card">
              <div className="untagged-thumb">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" />
                ) : (
                  <div className="untagged-placeholder">🛒</div>
                )}
              </div>
              <div className="untagged-info">
                {item.brand && <div className="untagged-brand">{item.brand}</div>}
                <div className="untagged-name">{item.productName}</div>
                <div className="untagged-meta">
                  ${item.lowestPrice} at {item.store?.name || 'Unknown store'}
                </div>
              </div>
              <div className="untagged-actions">
                <button
                  className={savedUpcs.has(String(item.upc)) ? 'save-heart-btn save-heart-btn-saved' : 'save-heart-btn'}
                  onClick={() => {
                    const upc = String(item.upc)
                    if (savedUpcs.has(upc)) {
                      removeSavedItem(userId, upc)
                      onItemRemoved?.(upc)
                    } else {
                      saveItem(userId, item)
                      onItemSaved?.(item)
                    }
                  }}
                >
                  {savedUpcs.has(String(item.upc))
                    ? <><Heart size={13} fill="currentColor" /> Saved</>
                    : <><Heart size={13} /> Save</>}
                </button>
                <button
                  className="save-heart-btn"
                  onClick={() => setReportTarget({ targetId: String(item.upc), targetName: item.productName })}
                >
                  <AlertTriangle size={13} /> Report
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {inDrill && selectedSubcategory && !inLevel1 && !inUntaggedView && (
        <>
          <div className="drill-header">
            <button className="drill-back-btn" onClick={handleBack}>‹ Back</button>
            <div className="drill-breadcrumb">{buildBreadcrumb()}</div>
            {drillData?.nextDimension && (
              <h2 className="drill-title">
                Choose {drillData.nextDimension.def.label}
              </h2>
            )}
          </div>

          {(browseLoading || !drillData) && (
            <div className="drill-loading">Loading…</div>
          )}

          {/* Drill level — options */}
          {!browseLoading && drillData?.nextDimension && (
            drillData.options.length === 0
              ? <div className="drill-empty">No options defined.</div>
              : drillData.options.map(opt => {
                  const display = SUBCATEGORY_DISPLAY[selectedSubcategory] || { emoji: '📦' };
                  const isEmptyLane = opt.productCount === 0;
                  return (
                    <div
                      key={opt.value}
                      className={`drill-tile-card${isEmptyLane ? ' empty-lane' : ''}`}
                      onClick={() => handleAttributeValueClick(
                        drillData.nextDimension.key,
                        opt.value
                      )}
                    >
                      <div className="drill-tile-thumb">
                        <div className="drill-tile-placeholder">{display.emoji}</div>
                      </div>
                      <div className="drill-tile-info">
                        <div className="drill-tile-label">{opt.label}</div>
                        {isEmptyLane ? (
                          <div className="drill-tile-meta empty-lane-text">
                            Not yet scanned
                          </div>
                        ) : (
                          <div className="drill-tile-meta">
                            {opt.productCount} product{opt.productCount !== 1 ? 's' : ''} ·
                            {' '}{opt.storeCount} store{opt.storeCount !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                      <div className="drill-tile-trailing">
                        {opt.lowestPrice ? (
                          <>
                            <div className="drill-tile-price">from ${opt.lowestPrice}</div>
                            {opt.unitPrice && opt.unitLabel && (
                              <div className="drill-tile-unit">
                                ${opt.unitPrice.toFixed(2)} {opt.unitLabel}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="drill-tile-price empty-lane-text">—</div>
                        )}
                      </div>
                      <span className="drill-tile-arrow">›</span>
                    </div>
                  );
                })
          )}

          {/* Final level — product results */}
          {!browseLoading && drillData && !drillData.nextDimension && (
            <>
              {drillData.productResults.length === 0 && (
                <div className="drill-empty-leaf">
                  <div className="drill-empty-leaf-icon">🛒</div>
                  <h3 className="drill-empty-leaf-title">No prices yet</h3>
                  <p className="drill-empty-leaf-body">
                    Be the first to scan {buildBreadcrumb()}!
                  </p>
                </div>
              )}
              {drillData.productResults.map(result => {
                const hoursAgo = result.createdAt
                  ? (Date.now() - new Date(result.createdAt).getTime()) / 36e5
                  : null;
                const freshnessClass = hoursAgo === null ? 'dot-gray'
                  : hoursAgo < 24 ? 'dot-green'
                  : hoursAgo < 168 ? 'dot-yellow'
                  : 'dot-red';
                const freshnessLabel = hoursAgo === null ? 'Unknown'
                  : hoursAgo < 1 ? 'Just now'
                  : hoursAgo < 24 ? `${Math.floor(hoursAgo)}h ago`
                  : hoursAgo < 168 ? `${Math.floor(hoursAgo / 24)}d ago`
                  : `${Math.floor(hoursAgo / 168)}w ago`;
                return (
                  <div key={result.id} className="group-result-card">
                    <div className="group-result-thumb">
                      {result.imageUrl ? (
                        <img src={result.imageUrl} alt="" />
                      ) : (
                        <div className="group-result-placeholder">🥚</div>
                      )}
                    </div>
                    <div className="group-result-info">
                      {result.brand && (
                        <div className="group-result-brand">{result.brand}</div>
                      )}
                      <div className="group-result-name">{result.productName}</div>
                      <div className="group-result-store-row">
                        {result.store?.name || 'Unknown store'}
                        {result.store?.city ? ` · ${result.store.city}` : ''}
                      </div>
                      <div className="group-result-freshness">
                        <span className={`freshness-dot ${freshnessClass}`} />
                        {freshnessLabel}
                      </div>
                    </div>
                    <div className="group-result-trailing">
                      <div className="group-result-price">${result.price}</div>
                      {result.unitPrice && result.unitLabel && (
                        <div className="group-result-unit">
                          ${result.unitPrice.toFixed(2)} {result.unitLabel}
                        </div>
                      )}
                      <div className="group-result-actions">
                        <button
                          className={savedUpcs.has(String(result.barcode)) ? 'save-heart-btn save-heart-btn-saved' : 'save-heart-btn'}
                          onClick={() => {
                            const upc = String(result.barcode)
                            if (savedUpcs.has(upc)) {
                              removeSavedItem(userId, upc)
                              onItemRemoved?.(upc)
                            } else {
                              saveItem(userId, result)
                              onItemSaved?.(result)
                            }
                          }}
                        >
                          {savedUpcs.has(String(result.barcode))
                            ? <><Heart size={13} fill="currentColor" /> Saved</>
                            : <><Heart size={13} /> Save</>}
                        </button>
                        <button
                          className="save-heart-btn"
                          onClick={() => setReportTarget({ targetId: String(result.barcode), targetName: result.productName })}
                        >
                          <AlertTriangle size={13} /> Report
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {!inDrill && (
        <>
          <button className="back-btn" onClick={onBack}>← Back</button>
          <div className="cat-page-header">
            <span className="cat-emoji-pill">🗂️</span>
            <h2 className="categories-title">Categories</h2>
            <p className="categories-sub">Built from real community scans</p>
          </div>

          {loading && <p className="recent-loading">Loading categories…</p>}

          {!loading && groups.length === 0 && (
            <div className="recent-empty">
              <p className="recent-empty-title">Nothing here yet — start scanning! 🐿️</p>
            </div>
          )}

          {!loading && groups.length > 0 && (
            <div className="categories-grid">
              {groups.map(g => {
                const meta = CAT_META[g.name] || CAT_META['Miscellaneous']
                const fresh = cardFreshness(g.products)
                return (
                  <button
                    key={g.name}
                    className="cat-card"
                    onClick={() => { handleDeptClick(g.name); setExpanded(g.name); }}
                  >
                    <div className="cat-card-top" style={{ background: meta.bg }}>
                      <span className="cat-card-emoji-fade">{meta.emoji}</span>
                      <span className="cat-card-emoji-main">{meta.emoji}</span>
                    </div>
                    <div className="cat-card-body">
                      <div className="cat-card-name">{g.name}</div>
                      <div className="cat-card-meta">
                        <span className="cat-card-count">
                          {g.itemCount} item{g.itemCount !== 1 ? 's' : ''}
                        </span>
                        <span className="cat-card-freshness" style={{ color: fresh.color }}>
                          <span className="cat-card-dot" style={{ background: fresh.dot }} />
                          {fresh.label}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
