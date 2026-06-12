import { supabase } from '../client'
import type { Transaction } from '../../types/transaction'

type OfferName = { name: string } | null

type BuyRow = Omit<Transaction, 'offer_name' | 'source'> & { qr_offers: OfferName }

type CounterOfferRow = {
  id: string
  offer_id: string
  buyer_wallet: string
  tx_signature: string
  seller_amount: number
  fee_amount: number
  quantity: number
  created_at: string
  qr_offers: OfferName
}

export async function getTransactionsBySeller(): Promise<Transaction[]> {
  const [buysResult, counterOffersResult] = await Promise.all([
    supabase
      .from('qr_transactions')
      .select('*, qr_offers(name)')
      .order('created_at', { ascending: false }),
    supabase
      .from('qr_counteroffers')
      .select('*, qr_offers(name)')
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false }),
  ])

  if (buysResult.error) throw buysResult.error
  if (counterOffersResult.error) throw counterOffersResult.error

  const buys: Transaction[] = (buysResult.data as unknown as BuyRow[]).map((row) => {
    const { qr_offers, ...rest } = row
    return {
      ...rest,
      offer_name: qr_offers?.name ?? '',
      source: 'buy' as const,
    }
  })

  const counterOffers: Transaction[] = (counterOffersResult.data as unknown as CounterOfferRow[]).map((row) => {
    const { qr_offers, buyer_wallet, offer_id, tx_signature, seller_amount, fee_amount, quantity, created_at, id } = row
    return {
      id,
      offer_id,
      offer_name: qr_offers?.name ?? '',
      buyer_wallet,
      tx_signature,
      seller_amount,
      fee_amount,
      quantity,
      created_at,
      source: 'counter_offer' as const,
    }
  })

  return [...buys, ...counterOffers].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
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
