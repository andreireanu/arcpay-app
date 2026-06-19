import { supabase } from '../client'
import type { Transaction } from '../../types/transaction'

export interface TransactionPage {
  transactions: Transaction[]
  total: number
}

// Server-side paginated transaction history for a seller. Reads the
// qr_seller_transactions view (a UNION of direct buys + confirmed counter
// offers, normalized to the Transaction shape) scoped explicitly to
// seller_wallet — NOT by RLS, since a wallet that also buys would otherwise
// match its own purchases through the buyer SELECT policies. `count: 'exact'`
// returns the full row count for computing page boundaries.
export async function getTransactionsBySeller(
  sellerWallet: string,
  page = 0,
  pageSize = 10,
  offerId?: string,
): Promise<TransactionPage> {
  const from = page * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('qr_seller_transactions')
    .select('*', { count: 'exact' })
    .eq('seller_wallet', sellerWallet)
    // Sellers see only settled rows; canceled offers are buyer-side history.
    .in('status', ['confirmed', 'auto_confirmed'])
  if (offerId) query = query.eq('offer_id', offerId)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  return {
    transactions: (data ?? []) as unknown as Transaction[],
    total: count ?? 0,
  }
}

// Buyer-side transaction history. Reads the SAME qr_seller_transactions view
// (buys + confirmed counter offers) but scoped explicitly to buyer_wallet — NOT
// by RLS. A wallet that is both a seller and a buyer satisfies both the seller
// and buyer SELECT policies, so the view would otherwise also return the rows
// this wallet *received* as a seller. Filtering by buyer_wallet keeps it to the
// wallet's own purchases. (Requires the "buyers can read own transactions"
// policy on qr_transactions.)
export async function getTransactionsByBuyer(
  buyerWallet: string,
  page = 0,
  pageSize = 10,
  offerId?: string,
): Promise<TransactionPage> {
  const from = page * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('qr_seller_transactions')
    .select('*', { count: 'exact' })
    .eq('buyer_wallet', buyerWallet)
    // Purchases only; canceled offers live in the buyer's "Past offers" tab.
    .in('status', ['confirmed', 'auto_confirmed'])
  if (offerId) query = query.eq('offer_id', offerId)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  return {
    transactions: (data ?? []) as unknown as Transaction[],
    total: count ?? 0,
  }
}

// The buyer's canceled counter offers (their "Past offers" tab) — offers that
// ended without a purchase, by either party. Reads the same view filtered to the
// canceled statuses, scoped to buyer_wallet for the same reason as above.
export async function getCanceledOffersByBuyer(
  buyerWallet: string,
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('qr_seller_transactions')
    .select('*')
    .eq('buyer_wallet', buyerWallet)
    .in('status', ['buyer_canceled', 'seller_canceled'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return (data ?? []) as unknown as Transaction[]
}

// Raw qr_transactions row as delivered by Realtime (no qr_offers join, no source
// discriminator — the caller enriches those).
export type TransactionRow = Omit<Transaction, 'offer_name' | 'source'>

// Watch for new buys on a given offer. RLS scopes delivery to the seller's own
// offers; qr_transactions must be in the supabase_realtime publication.
export function watchNewTransactions(
  offerId: string,
  onInsert: (row: TransactionRow) => void,
): () => void {
  const channel = supabase
    .channel(`transaction-new-${offerId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qr_transactions', filter: `offer_id=eq.${offerId}` },
      (payload) => onInsert(payload.new as TransactionRow),
    )
    .subscribe()
  return () => channel.unsubscribe()
}

// Watch for new buys made BY this wallet (buyer dashboard). qr_transactions is
// in the realtime publication; the buyer SELECT RLS scopes delivery to rows
// where buyer_wallet matches, and the filter keeps it tight.
export function watchBuyerTransactions(
  buyerWallet: string,
  onInsert: (row: TransactionRow) => void,
): () => void {
  const channel = supabase
    .channel(`buyer-transaction-new-${buyerWallet}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qr_transactions', filter: `buyer_wallet=eq.${buyerWallet}` },
      (payload) => onInsert(payload.new as TransactionRow),
    )
    .subscribe()
  return () => channel.unsubscribe()
}

// Watch for counter offers settling on a given offer (status flips to
// `confirmed` — or `auto_confirmed` when the auto-accept rule settled it — once
// the settle webhook processes the OfferBought event). These become rows in the
// seller's transactions list, mirroring watchNewTransactions for buys. RLS
// scopes delivery to the seller's own offers. The `source` is derived from the
// status so callers don't hardcode it (matches the qr_seller_transactions view).
export function watchSettledCounterOffers(
  offerId: string,
  onSettled: (row: TransactionRow & { source: 'counter_offer' | 'auto_confirmed' }) => void,
): () => void {
  const channel = supabase
    .channel(`counter-offer-settled-${offerId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'qr_counteroffers', filter: `offer_id=eq.${offerId}` },
      (payload) => {
        const row = payload.new as TransactionRow & {
          status: string
          confirmed_at: string | null
        }
        if (row.status !== 'confirmed' && row.status !== 'auto_confirmed') return
        const source = row.status === 'auto_confirmed' ? 'auto_confirmed' : 'counter_offer'
        // For a counter offer the execution time is confirmed_at (when this
        // settle flipped it), not created_at (when the buyer placed it). Mirror
        // the qr_seller_transactions view so live rows match a reload.
        onSettled({ ...row, source, created_at: row.confirmed_at ?? row.created_at })
      },
    )
    .subscribe()
  return () => channel.unsubscribe()
}
