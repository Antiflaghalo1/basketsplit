import { useState, useEffect, useRef } from 'react'
import { Package } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ProfileView({ user, firstName, lastName, avatarUrl, onAvatarUpload, onSignOut, onMyScans }) {
  const [count, setCount] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadSaved, setUploadSaved] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    supabase
      .from('observations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .then(({ count: c }) => setCount(c ?? 0))
  }, [user.id])

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadSaved(false)
    try {
      await onAvatarUpload(file)
      setUploadSaved(true)
      setTimeout(() => setUploadSaved(false), 2000)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const userInitial = user?.email?.[0]?.toUpperCase()

  return (
    <div className="profile-view">
      <div className="avatar-circle">
        {avatarUrl
          ? <img src={avatarUrl} alt="Profile photo" />
          : userInitial
        }
      </div>
      <button
        type="button"
        className="avatar-change-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? 'Uploading…' : uploadSaved ? 'Saved! ✓' : 'Change photo'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <p className="profile-email profile-view-email">{user.email}</p>
      {(firstName || lastName) && (
        <p style={{ textAlign: 'center', fontSize: 16, fontWeight: 700, marginTop: 2, marginBottom: 0 }}>
          {[firstName, lastName].filter(Boolean).join(' ')}
        </p>
      )}
      <button
        type="button"
        style={{ display: 'block', margin: '6px auto 0', background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
      >
        Edit profile
      </button>
      <div className="profile-stat">
        <span className="profile-stat-num">{count ?? '—'}</span>
        <span className="profile-stat-label">My Submissions</span>
      </div>
      <button className="drawer-menu-row" onClick={onMyScans}>
        <span className="drawer-row-icon"><Package size={18} color="var(--green)" /></span>
        My Recent Scans →
      </button>
      <button className="profile-signout-btn profile-view-signout" onClick={onSignOut}>
        Sign Out
      </button>
    </div>
  )
}
