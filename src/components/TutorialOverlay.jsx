import { useState, useRef } from 'react'

const CARDS = [
  {
    emoji: '📷',
    title: 'Scan prices as you shop',
    body: 'Point your camera at any barcode — we log the price instantly.',
  },
  {
    emoji: '🛒',
    title: 'Find your cheapest basket',
    body: 'Tell us what you need. We split your list across stores to save you the most money.',
  },
  {
    emoji: '🐿️',
    title: "You're building something bigger",
    body: 'Every scan helps your whole community shop smarter. Welcome to BasketSplit.',
  },
]

export default function TutorialOverlay({ onComplete }) {
  const [index, setIndex] = useState(0)
  const touchStartX = useRef(null)
  const isLast = index === CARDS.length - 1

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e) {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (delta < -50 && !isLast) setIndex(i => i + 1)
    if (delta > 50 && index > 0) setIndex(i => i - 1)
  }

  return (
    <div
      className="tutorial-overlay"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <button className="tutorial-skip" onClick={onComplete}>Skip</button>

      <div className="tutorial-viewport">
        <div
          className="tutorial-track"
          style={{ transform: `translateX(calc(-${index} * 100% / 3))` }}
        >
          {CARDS.map((card, i) => (
            <div key={i} className="tutorial-card">
              <div className="tutorial-card-header">
                <span className="tutorial-emoji">{card.emoji}</span>
              </div>
              <div className="tutorial-card-body">
                <h2 className="tutorial-title">{card.title}</h2>
                <p className="tutorial-body-text">{card.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="tutorial-dots">
        {CARDS.map((_, i) => (
          <div key={i} className={`tutorial-dot${i === index ? ' tutorial-dot-active' : ''}`} />
        ))}
      </div>

      <button
        className="cta-btn tutorial-cta"
        onClick={isLast ? onComplete : () => setIndex(i => i + 1)}
      >
        {isLast ? "Let's go →" : 'Next →'}
      </button>
    </div>
  )
}
