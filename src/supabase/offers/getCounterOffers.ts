import { supabase } from '../client'
import type { CounterOffer } from '../../types/counterOffer'

export interface SellerCounterOffers {
  visible: CounterOffer[]
  hiddenCount: number
}

export async function getCounterOffersBySeller(): Promise<SellerCounterOffers> {
  const [coResult, hiddenResult] = await Promise.all([
    supabase
      .from('qr_counteroffers')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    // RLS scopes this to the seller's own hidden rows. Presence ⇒ hidden.
    supabase.from('qr_counteroffers_seller_state').select('counteroffer_id'),
  ])
  if (coResult.error) throw coResult.error
  if (hiddenResult.error) throw hiddenResult.error

  const hiddenIds = new Set(
    (hiddenResult.data as { counteroffer_id: string }[]).map((r) => r.counteroffer_id),
  )

  const active = coResult.data as CounterOffer[]
  const visible = active.filter((row) => !hiddenIds.has(row.id))

  // Count only hidden rows whose counter offer is still active — i.e. the ones
  // that would actually reappear if unhidden. Derived from the same data as the
  // filter above, so the count and the list can never disagree.
  const hiddenCount = active.filter((row) => hiddenIds.has(row.id)).length

  return { visible, hiddenCount }
}

// Hide a counter offer from the seller's active list by inserting a presence
// row. RLS allows this only for counter offers on the seller's own offers, and
// the table has no sensitive columns, so the seller can never touch
// qr_counteroffers directly. On RLS rejection the insert errors out.
export async function hideCounterOffer(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('qr_counteroffers_seller_state')
    .insert({ counteroffer_id: id })
    .select('counteroffer_id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Hide blocked by server')
}

// Hide several counter offers at once (Hide selected). RLS confines the insert
// to the seller's own counter offers.
export async function hideCounterOffers(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('qr_counteroffers_seller_state')
    .insert(ids.map((counteroffer_id) => ({ counteroffer_id })))
  if (error) throw error
}

// Unhide every counter offer the seller has hidden, deleting their presence
// rows. The `not is null` filter matches all rows; RLS confines the delete to
// the seller's own counter offers.
export async function unhideAllCounterOffers(): Promise<void> {
  const { error } = await supabase
    .from('qr_counteroffers_seller_state')
    .delete()
    .not('counteroffer_id', 'is', null)
  if (error) throw error
}

// Unhide a specific set of counter offers (used by a single offer's page).
// RLS confines the delete to the seller's own counter offers.
export async function unhideCounterOffers(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('qr_counteroffers_seller_state')
    .delete()
    .in('counteroffer_id', ids)
  if (error) throw error
}

export interface OfferCounterOffers {
  visible: CounterOffer[]
  hiddenIds: string[]
}

export async function getCounterOffersByOffer(offerId: string): Promise<OfferCounterOffers> {
  const [coResult, hiddenResult] = await Promise.all([
    supabase
      .from('qr_counteroffers')
      .select('*')
      .eq('offer_id', offerId)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    // RLS scopes this to the seller's own hidden rows. Presence ⇒ hidden.
    supabase.from('qr_counteroffers_seller_state').select('counteroffer_id'),
  ])
  if (coResult.error) throw coResult.error
  if (hiddenResult.error) throw hiddenResult.error

  const hiddenSet = new Set(
    (hiddenResult.data as { counteroffer_id: string }[]).map((r) => r.counteroffer_id),
  )
  const all = coResult.data as CounterOffer[]
  return {
    visible: all.filter((co) => !hiddenSet.has(co.id)),
    hiddenIds: all.filter((co) => hiddenSet.has(co.id)).map((co) => co.id),
  }
}

export function watchBuyerCounterOfferInsert(
  offerId: string,
  buyerWallet: string,
  onInsert: (counterOffer: CounterOffer) => void,
): () => void {
  const channel = supabase
    .channel(`counter-offer-buyer-${offerId}-${buyerWallet}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qr_counteroffers', filter: `offer_id=eq.${offerId}` },
      (payload) => {
        const row = payload.new as CounterOffer
        if (row.buyer_wallet === buyerWallet) onInsert(row)
      },
    )
    .subscribe()
  return () => channel.unsubscribe()
}

export function watchNewCounterOffers(
  offerId: string,
  onNew: (counterOffer: CounterOffer) => void,
): () => void {
  const channel = supabase
    .channel(`counter-offer-new-${offerId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qr_counteroffers', filter: `offer_id=eq.${offerId}` },
      (payload) => onNew(payload.new as CounterOffer),
    )
    .subscribe()
  return () => channel.unsubscribe()
}

export function watchCounterOfferStatuses(
  counterOfferIds: string[],
  onUpdate: (id: string, status: CounterOffer['status']) => void,
): () => void {
  if (counterOfferIds.length === 0) return () => {}
  const channels = counterOfferIds.map((id) =>
    supabase
      .channel(`counter-offer-status-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'qr_counteroffers', filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as Partial<CounterOffer>
          if (row.status !== undefined) onUpdate(id, row.status)
        },
      )
      .subscribe(),
  )
  return () => channels.forEach((c) => c.unsubscribe())
}

export async function getCounterOfferByBuyer(offerId: string, buyerWallet: string): Promise<CounterOffer | null> {
  const { data: { session } } = await supabase.auth.getSession()
  console.log('[getCounterOfferByBuyer] session app_metadata:', session?.user?.app_metadata ?? 'NO SESSION')
  console.log('[getCounterOfferByBuyer] querying', { offerId, buyerWallet })
  const { data, error } = await supabase
    .from('qr_counteroffers')
    .select('*')
    .eq('offer_id', offerId)
    .eq('buyer_wallet', buyerWallet)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  console.log('[getCounterOfferByBuyer] result', { data, error })
  if (error) throw error
  return data as CounterOffer | null
}
