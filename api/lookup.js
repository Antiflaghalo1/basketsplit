export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const { upc } = req.query
  if (!upc) {
    return res.status(400).json({ image_url: null, brand: null, category: null })
  }

  try {
    const upstream = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`,
      { headers: { 'Content-Type': 'application/json' } }
    )
    const data = await upstream.json()
    const item = data.items?.[0]
    return res.status(200).json({
      image_url: item?.images?.[0] ?? null,
      brand: item?.brand ?? null,
      category: item?.category ?? null,
    })
  } catch {
    return res.status(200).json({ image_url: null, brand: null, category: null })
  }
}
