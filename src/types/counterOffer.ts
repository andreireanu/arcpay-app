export interface CounterOffer {
  id: string;
  offer_id: string;
  ephemeral_id: string;
  buyer_wallet: string;
  tx_signature: string;
  seller_amount: number;
  fee_amount: number;
  quantity: number;
  status:
    | "active"
    | "confirmed"
    | "buyer_canceled"
    | "seller_canceled";
  created_at: string;
  expiry_at: string;
  chain: "sui" | "solana";
  sui_object_id: string | null;
}
