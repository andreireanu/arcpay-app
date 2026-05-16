export interface CounterOffer {
  id: string
  offer_id: string
  buyer_wallet: string
  tx_signature: string
  amount: number
  quantity: number
  status: 'active' | 'canceled' | 'confirmed'
  created_at: string
  expiry_at: string
}
