import { useState, useEffect, useRef } from 'react'
import { Package } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ProfileView({ user, firstName, lastName, avatarUrl, onAvatarUpload, onSignOut, onMyScans, onEditProfile }) {
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
          ? <img src={avatarUrl} alt="Profile photo" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }} />
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
        onClick={onEditProfile}
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
      {process.env.NODE_ENV !== 'production' && (
        <button
          onClick={async () => {
            try {
              const reg = await navigator.serviceWorker.ready
              console.log('[Test] SW ready')
              const existing = await reg.pushManager.getSubscription()
              console.log('[Test] Existing sub:', existing)
              const sub = existing || await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: (() => {
                  const base64String = import.meta.env.VITE_VAPID_PUBLIC
                  const padding = '='.repeat((4 - base64String.length % 4) % 4)
                  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
                  const rawData = window.atob(base64)
                  const outputArray = new Uint8Array(rawData.length)
                  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
                  return outputArray
                })()
              })
              if (user?.id) {
                const { error } = await supabase.from('push_subscriptions').upsert({
                  user_id: user.id,
                  subscription: sub.toJSON()
                }, { onConflict: 'user_id' })
                if (error) {
                  console.error('[Test] Supabase error:', error)
                } else {
                  console.log('[Test] Saved to Supabase!')
                }
              }
              console.log('[Test] Sub object:', JSON.stringify(sub))
              const res = await fetch('/api/send-push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subscription: sub,
                  title: '🐿️ Test notification!',
                  body: 'Squrry push pipeline is working.'
                })
              })
              const data = await res.json()
              console.log('[Test] Push response:', data)
              alert('Push: ' + JSON.stringify(data) + ' | User: ' + user?.id + ' | Sub: ' + !!sub)
            } catch(err) {
              console.error('[Test] Error:', err)
              alert('Error: ' + err.message)
            }
          }}
          style={{
            marginTop: 16,
            padding: '10px 20px',
            background: '#C8622A',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            width: '100%'
          }}
        >
          🧪 Test Push Notification
        </button>
      )}
      <button
        onClick={async () => {
          try {
            const reg = await navigator.serviceWorker.ready
            const existing = await reg.pushManager.getSubscription()
            const sub = existing || await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: (() => {
                const base64String = import.meta.env.VITE_VAPID_PUBLIC
                const padding = '='.repeat((4 - base64String.length % 4) % 4)
                const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
                const rawData = window.atob(base64)
                const outputArray = new Uint8Array(rawData.length)
                for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
                return outputArray
              })()
            })
            const res = await fetch('/api/send-push', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subscription: sub,
                title: '🐿️ Test notification!',
                body: 'Squrry push pipeline is working.'
              })
            })
            const data = await res.json()
            const saveResult = user?.id ? await supabase.from('push_subscriptions').upsert({
              user_id: user.id,
              subscription: sub.toJSON()
            }, { onConflict: 'user_id' }) : { error: 'no user id' }

            alert('Push: ' + JSON.stringify(data) + '\nUser ID: ' + user?.id + '\nSave error: ' + JSON.stringify(saveResult?.error) + '\nSub type: ' + typeof sub.toJSON())
          } catch(err) {
            alert('Error: ' + err.message)
          }
        }}
        style={{
          marginTop: 16, marginBottom: 8,
          padding: '10px 20px',
          background: '#C8622A',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          width: '100%'
        }}
      >
        🧪 Test Push Notification
      </button>
      <button className="profile-signout-btn profile-view-signout" onClick={onSignOut}>
        Sign Out
      </button>
    </div>
  )
}
