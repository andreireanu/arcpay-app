export interface Offer {
  id: string;
  seller_wallet: string;
  name: string;
  description: string | null;
  price_lamports: number;
  fee_bps: number;
  status: "unlisted" | "active" | "paused" | "canceled" | "sold";
  quantity: number;
  quantity_sold: number;
  unlimited: boolean;
  created_at: string;
}
