import { supabase } from '../client'
import type { Product } from '../../types/product'

export async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabase.from('products').select('*').order('created_at')
  if (error) throw error
  return data
}

export async function getProduct(id: string): Promise<Product> {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).single()
  if (error) throw error
  return data
}
