export interface CounterOffer {
  id: string;
  offer_id: string;
  ephemeral_id: string;
  buyer_wallet: string;
  tx_signature: string;
  amount: number;
  quantity: number;
  status:
    | "active"
    | "active_hidden"
    | "confirmed"
    | "buyer_canceled"
    | "seller_canceled";
  created_at: string;
  expiry_at: string;
}
