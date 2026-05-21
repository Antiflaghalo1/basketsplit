import { useState, useEffect, useRef } from 'react'

const TIMEFRAMES = [
  { key: 'weekly',   label: 'Weekly',    sub: 'per week' },
  { key: 'biweekly', label: 'Bi-weekly', sub: 'every 2 weeks' },
  { key: 'monthly',  label: 'Monthly',   sub: 'per month' },
]

function getSavingsTip(v) {
  if (v < 100) return "💡 Tight but doable — we'll find every dollar."
  if (v < 300) return "💡 Solid budget — you've got room to optimize."
  if (v < 600) return "💡 Good range — we can find real savings here."
  return "💡 Plenty to work with — let's find the deals."
}

export default function BudgetView({ onBack, user, budget, onBudgetSave }) {
  const [value, setValue] = useState(budget ?? 0)
  const [saved, setSaved] = useState(false)
  const [timeframe, setTimeframe] = useState('weekly')
  const [pulseActive, setPulseActive] = useState(false)
  const isMounted = useRef(false)

  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return }
    setPulseActive(true)
    const t = setTimeout(() => setPulseActive(false), 200)
    return () => clearTimeout(t)
  }, [value])

  async function handleSave() {
    await onBudgetSave(value)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const pct = (value / 1000) * 100
  const timeframeSub = TIMEFRAMES.find(t => t.key === timeframe).sub

  return (
    <div className="budget-view">
      <button className="back-btn" onClick={onBack}>← Back</button>

      <h2 className="budget-view-title">💰 My Budget</h2>
      <p className="budget-view-sub">
        Set your grocery budget and we'll track how close you are.
      </p>

      <div className={`budget-view-amount${pulseActive ? ' budget-amount-pulse' : ''}`}>
        ${value}
      </div>
      <p className="budget-timeframe-label">{timeframeSub}</p>

      <input
        className="budget-slider"
        type="range"
        min={0}
        max={1000}
        step={10}
        value={value}
        onChange={e => setValue(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--green) ${pct}%, var(--border) ${pct}%)`
        }}
      />

      <div className="budget-view-range-labels">
        <span>$0</span>
        <span>$1000</span>
      </div>

      <div className="budget-pills">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.key}
            className={`budget-pill${timeframe === tf.key ? ' budget-pill-active' : ''}`}
            onClick={() => setTimeframe(tf.key)}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <button className="cta-btn budget-view-cta" onClick={handleSave}>
        Save Budget →
      </button>

      {saved && <p className="budget-view-saved">Saved! ✓</p>}

      <p className="budget-savings-tip">{getSavingsTip(value)}</p>
    </div>
  )
}
