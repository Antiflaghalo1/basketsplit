import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthView({ onBack, gated = false, onLegal }) {
  const [mode, setMode] = useState('signin') // signin | signup
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetMsg, setResetMsg] = useState('')
  const [resetError, setResetError] = useState('')

  async function handleSubmit() {
    setError('')
    setSuccess('')
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.')
      return
    }
    setLoading(true)
    if (mode === 'signin') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) setError(err.message)
      else onBack()
    } else {
      const { data, error: err } = await supabase.auth.signUp({ email, password })
      if (err) {
        setError(err.message)
      } else {
        if (data?.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
          })
        }
        setSuccess("Check your email to confirm your account, then sign in.")
      }
    }
    setLoading(false)
  }

  return (
    <div className="scan-form" style={{ maxWidth: 420, margin: '0 auto', paddingTop: 32 }}>
      {!gated && <button className="back-btn" onClick={onBack}>← Back</button>}

      <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--green)', marginBottom: 4, marginTop: 16 }}>
        {mode === 'signin' ? 'Welcome back 👋' : 'Create an account 🐿️'}
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>
        {mode === 'signin'
          ? 'Sign in to save your price submissions and build your reputation.'
          : 'Join BasketSplit to submit prices and help your community save money.'}
      </p>

      {mode === 'signup' && (
        <>
          <label className="scan-label">First Name</label>
          <input
            className="scan-input"
            type="text"
            placeholder="Optional"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
          />
          <label className="scan-label" style={{ marginTop: 14 }}>Last Name</label>
          <input
            className="scan-input"
            type="text"
            placeholder="Optional"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
          />
          <label className="scan-label" style={{ marginTop: 14 }}>Email</label>
        </>
      )}
      {mode === 'signin' && <label className="scan-label">Email</label>}
      <input
        className="scan-input"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        autoCapitalize="none"
      />

      <label className="scan-label" style={{ marginTop: 14 }}>Password</label>
      <input
        className="scan-input"
        type="password"
        placeholder="••••••••"
        value={password}
        onChange={e => setPassword(e.target.value)}
      />

      {mode === 'signin' && (
        <div style={{ textAlign: 'right', marginTop: 6 }}>
          <button
            type="button"
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
            disabled={resetLoading}
            onClick={async () => {
              setResetMsg('')
              setResetError('')
              if (!email.trim()) { setResetError('Enter your email above first.'); return }
              setResetLoading(true)
              const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim())
              setResetLoading(false)
              if (err) setResetError(err.message)
              else setResetMsg('Check your inbox — we sent a reset link 📬')
            }}
          >
            {resetLoading ? 'Sending…' : 'Forgot your password?'}
          </button>
          {resetMsg && <p style={{ color: 'var(--green)', fontSize: 13, marginTop: 6, fontWeight: 600 }}>{resetMsg}</p>}
          {resetError && <p style={{ color: '#C62828', fontSize: 13, marginTop: 6 }}>{resetError}</p>}
        </div>
      )}

      {error && (
        <p style={{ color: '#C62828', fontSize: 13, marginTop: 10 }}>{error}</p>
      )}
      {success && (
        <p style={{ color: 'var(--green)', fontSize: 13, marginTop: 10, fontWeight: 600 }}>{success}</p>
      )}

      <button
        className="cta-btn"
        style={{ marginTop: 24 }}
        onClick={handleSubmit}
        disabled={loading}
      >
        {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In →' : 'Create Account →'}
      </button>

      <button
        type="button"
        className="add-store-btn"
        style={{ marginTop: 12, textAlign: 'center' }}
        onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setSuccess('') }}
      >
        {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
      </button>

      <div style={{ marginTop: 32, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
        <button
          type="button"
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => onLegal?.('tos')}
        >
          Terms of Service
        </button>
        <span style={{ margin: '0 8px' }}>·</span>
        <button
          type="button"
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => onLegal?.('privacy')}
        >
          Privacy Policy
        </button>
      </div>
    </div>
  )
}
