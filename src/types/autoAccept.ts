export interface AutoAccept {
  offer_id: string;
  quantity: number;
  avg_price: number;
  triggered_price: number | null;
  triggered_at: string | null;
  created_at: string;
}
