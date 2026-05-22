import { Wallet, Package, FileText, Shield, LogOut, HelpCircle } from 'lucide-react'

export default function HamburgerDrawer({ isOpen, onClose, budget, avatarUrl, firstName, lastName, userEmail, onBudgetNav, onLegal, onMyScans, onHelp, onSignOut }) {
  const displayName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : userEmail
  const initial = (firstName || userEmail || '?')[0].toUpperCase()

  return (
    <div className={`drawer-backdrop${isOpen ? ' drawer-backdrop--open' : ''}`} onClick={onClose}>
      <div
        className={`drawer${isOpen ? ' drawer--open' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <button className="drawer-close-btn" onClick={onClose}>✕</button>

        <div className="drawer-header">BasketSplit 🛒</div>

        <div className="drawer-profile">
          <div className="drawer-profile-avatar">
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" />
              : <span>{initial}</span>
            }
          </div>
          <div className="drawer-profile-info">
            <div className="drawer-profile-name">{displayName}</div>
            {(firstName || lastName) && userEmail && (
              <div className="drawer-profile-email">{userEmail}</div>
            )}
          </div>
        </div>

        <div className="drawer-divider" />

        <button
          className="drawer-menu-row"
          style={{ justifyContent: 'space-between' }}
          onClick={onBudgetNav}
        >
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <span className="drawer-row-icon"><Wallet size={18} color="var(--green)" /></span>
            <span className="drawer-section-label">My Budget</span>
          </span>
          <span className="budget-wrap">${budget ?? 0} →</span>
        </button>

        <div className="drawer-divider" />

        <button className="drawer-menu-row" onClick={onMyScans}>
          <span className="drawer-row-icon"><Package size={18} color="var(--green)" /></span>
          My Scans
        </button>
        <button className="drawer-menu-row" onClick={onHelp}>
          <span className="drawer-row-icon"><HelpCircle size={18} color="var(--green)" /></span>
          How it works
        </button>
        <button className="drawer-menu-row" onClick={() => onLegal('tos')}>
          <span className="drawer-row-icon"><FileText size={18} color="var(--text-muted)" /></span>
          Terms of Service
        </button>
        <button className="drawer-menu-row" onClick={() => onLegal('privacy')}>
          <span className="drawer-row-icon"><Shield size={18} color="var(--text-muted)" /></span>
          Privacy Policy
        </button>

        <div className="drawer-divider" />

        <button className="drawer-menu-row drawer-signout-row" onClick={onSignOut}>
          <span className="drawer-row-icon"><LogOut size={18} color="#C62828" /></span>
          Sign Out
        </button>
      </div>
    </div>
  )
}
