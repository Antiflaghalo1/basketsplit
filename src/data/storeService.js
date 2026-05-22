import { supabase } from '../lib/supabase'

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

export async function getAllStores() {
  const { data } = await supabase
    .from('stores')
    .select('id, name, location, city, lat, lng, color')
  return data || []
}

export async function addStore(store) {
  const { data: { user } } = await supabase.auth.getUser()
  const id = slugify(`${store.name}_${store.city}`)
  const { data, error } = await supabase
    .from('stores')
    .insert({
      id,
      name: store.name,
      location: store.location,
      city: store.city,
      color: '#888888',
      submitted_by: user?.id,
    })
  return { data, error }
}
