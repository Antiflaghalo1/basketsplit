import { useState } from 'react'
import { reportFlag } from '../data/flags'

const REASONS = [
  'Wrong item',
  'Wrong name',
  'Wrong price',
  'Wrong category',
  'Inappropriate',
  'Other',
]

export default function ReportModal({ targetId, targetName, userId, onClose, onSuccess }) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!reason) return
    setSubmitting(true)
    await reportFlag({ type: 'product', targetId, targetName, reason, details, userId })
    setSubmitting(false)
    setSubmitted(true)
    setTimeout(onSuccess ?? onClose, 1800)
  }

  return (
    <div className="report-modal-backdrop" onClick={onClose}>
      <div className="report-modal" onClick={e => e.stopPropagation()}>
        {submitted ? (
          <p style={{ textAlign: 'center', padding: '20px 0', color: 'var(--green)', fontWeight: 600, fontSize: 15 }}>
            Thanks — we'll review it
          </p>
        ) : (
          <>
            <h3 style={{ margin: '0 0 16px', fontSize: 17, color: 'var(--text)' }}>Report a problem</h3>
            <div className="report-modal-options">
              {REASONS.map(r => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 15, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="report-reason"
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                  />
                  {r}
                </label>
              ))}
            </div>
            <textarea
              placeholder="Additional details (optional)"
              value={details}
              onChange={e => setDetails(e.target.value)}
              style={{ width: '100%', marginTop: 14, padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border)', fontSize: 14, resize: 'vertical', minHeight: 72, boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
            <div className="report-modal-actions">
              <button className="cta-btn" onClick={handleSubmit} disabled={!reason || submitting}>
                Submit
              </button>
              <button className="add-store-cancel" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
