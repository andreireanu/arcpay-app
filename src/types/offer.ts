export interface Offer {
  id: string
  name: string
  description: string | null
  price_lamports: number
  status: 'unlisted' | 'active' | 'paused' | 'cancelled'
  created_at: string
}
