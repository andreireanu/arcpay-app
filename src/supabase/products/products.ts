import { supabase } from '../client'
import type { Product } from '../../types/product'

export async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabase.from('products').select('*').order('created_at')
  if (error) throw error
  return data
}
