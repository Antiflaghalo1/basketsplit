import { useState } from 'react'

export default function AllStoresView({ onBack, stores }) {
  const [filterCity, setFilterCity] = useState('All')

  const cities = [...new Set(stores.map(s => s.city).filter(Boolean))]
  const filteredStores = filterCity === 'All' ? stores : stores.filter(s => s.city === filterCity)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 8px' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}
        >←</button>
        <div style={{ fontWeight: 700, fontSize: 18 }}>All Stores 📍</div>
      </div>

      <div style={{ overflowX: 'auto', display: 'flex', gap: 8, padding: '4px 16px 8px', scrollbarWidth: 'none' }}>
        {['All', ...cities].map(city => (
          <button
            key={city}
            onClick={() => setFilterCity(city)}
            style={{
              flexShrink: 0,
              padding: '5px 14px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              border: filterCity === city ? 'none' : '1px solid var(--border)',
              background: filterCity === city ? 'var(--green)' : 'transparent',
              color: filterCity === city ? '#fff' : 'inherit',
            }}
          >{city}</button>
        ))}
      </div>

      <div style={{ padding: '0 16px 8px', fontSize: 12, color: 'var(--text-muted)' }}>
        {filteredStores.length} stores
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px 16px' }}>
        {filteredStores.map(store => (
          <div
            key={store.id}
            style={{
              background: 'var(--card-bg)',
              borderRadius: 12,
              padding: '14px 16px',
              marginBottom: 8,
              borderLeft: `4px solid ${store.color || 'var(--green)'}`,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15 }}>{store.name}</div>
            {store.location && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{store.location}</div>
            )}
            {store.city && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{store.city}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
