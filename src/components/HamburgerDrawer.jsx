export default function HamburgerDrawer({ isOpen, onClose, budget, onBudgetNav, onLegal, onMyScans, onHelp, onSignOut }) {
  return (
    <div className={`drawer-backdrop${isOpen ? ' drawer-backdrop--open' : ''}`} onClick={onClose}>
      <div
        className={`drawer${isOpen ? ' drawer--open' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <button className="drawer-close-btn" onClick={onClose}>✕</button>

        <div className="drawer-header">BasketSplit 🛒</div>

        <div className="drawer-divider" />

        <button
          className="drawer-menu-row"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          onClick={onBudgetNav}
        >
          <span className="drawer-section-label">💰 My Budget</span>
          <span className="budget-wrap">${budget ?? 0} →</span>
        </button>

        <div className="drawer-divider" />

        <button className="drawer-menu-row" onClick={onMyScans}>📦 My Scans</button>
        <button className="drawer-menu-row" onClick={onHelp}>❓ How it works</button>
        <button className="drawer-menu-row" onClick={() => onLegal('tos')}>📋 Terms of Service</button>
        <button className="drawer-menu-row" onClick={() => onLegal('privacy')}>🔒 Privacy Policy</button>

        <div className="drawer-divider" />

        <button className="drawer-menu-row drawer-signout-row" onClick={onSignOut}>👋 Sign Out</button>
      </div>
    </div>
  )
}
