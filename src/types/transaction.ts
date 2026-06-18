export interface Transaction {
  id: string;
  offer_id: string;
  offer_name: string;
  buyer_wallet: string;
  tx_signature: string;
  seller_amount: number;
  fee_amount: number;
  quantity: number;
  created_at: string;
  source: "buy" | "counter_offer";
  chain: "sui" | "solana";
}
