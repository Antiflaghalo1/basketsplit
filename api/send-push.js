import webpush from 'web-push'

webpush.setVapidDetails(
  'mailto:gregory.a.castellanos@gmail.com',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { subscription, title, body } = req.body
  if (!subscription) return res.status(400).json({ error: 'No subscription' })
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body })
    )
    res.status(200).json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
