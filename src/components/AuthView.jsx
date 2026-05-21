import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthView({ onBack, gated = false }) {
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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
      const { error: err } = await supabase.auth.signUp({ email, password })
      if (err) setError(err.message)
      else setSuccess("Check your email to confirm your account, then sign in.")
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

      <label className="scan-label">Email</label>
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
    </div>
  )
}
