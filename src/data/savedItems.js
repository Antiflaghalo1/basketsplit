import { supabase } from '../lib/supabase'

export async function getSavedItems(userId) {
  const { data } = await supabase
    .from('saved_items')
    .select('*')
    .eq('user_id', userId)
  return data || []
}

export async function saveItem(userId, product) {
  const { data, error } = await supabase
    .from('saved_items')
    .insert({
      user_id: userId,
      upc: product.upc,
      name: product.name,
      brand: product.brand,
      normalized_category: product.normalized_category,
      image_url: product.image_url,
    })
  return { data, error }
}

export async function removeSavedItem(userId, upc) {
  const { data, error } = await supabase
    .from('saved_items')
    .delete()
    .eq('user_id', userId)
    .eq('upc', upc)
  return { data, error }
}
