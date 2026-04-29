export interface Product {
  id: string
  name: string
  description: string | null
  image_url: string | null
  fee_bps: number
  created_at: string
}
