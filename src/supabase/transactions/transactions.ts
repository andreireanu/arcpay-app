import { supabase } from '../client'
import type { Transaction } from '../../types/transaction'

export interface TransactionPage {
  transactions: Transaction[]
  total: number
}

// Server-side paginated transaction history. Reads the qr_seller_transactions
// view (a UNION of direct buys + confirmed counter offers, already normalized
// to the Transaction shape and seller-scoped via the underlying tables' RLS),
// so each call fetches only its page. `count: 'exact'` returns the full row
// count for computing page boundaries without loading every row.
export async function getTransactionsBySeller(
  page = 0,
  pageSize = 10,
): Promise<TransactionPage> {
  const from = page * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('qr_seller_transactions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  return {
    transactions: (data ?? []) as unknown as Transaction[],
    total: count ?? 0,
  }
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

// Watch for counter offers settling on a given offer (status flips to
// `confirmed` when the settle webhook processes the OfferBought event). These
// become rows in the seller's transactions list, mirroring watchNewTransactions
// for buys. RLS scopes delivery to the seller's own offers.
export function watchSettledCounterOffers(
  offerId: string,
  onSettled: (row: TransactionRow) => void,
): () => void {
  const channel = supabase
    .channel(`counter-offer-settled-${offerId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'qr_counteroffers', filter: `offer_id=eq.${offerId}` },
      (payload) => {
        const row = payload.new as TransactionRow & { status: string }
        if (row.status !== 'confirmed') return
        onSettled(row)
      },
    )
    .subscribe()
  return () => channel.unsubscribe()
}
