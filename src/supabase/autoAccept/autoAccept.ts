import { supabase } from '../client'
import type { AutoAccept } from '../../types/autoAccept'

// All auto-accept rules for a set of offers, keyed by offer_id. Lets the
// dashboard show each card's on/off state in a single query.
export async function getAutoAcceptForOffers(
  offerIds: string[],
): Promise<Record<string, AutoAccept>> {
  if (offerIds.length === 0) return {}
  const { data, error } = await supabase
    .from('qr_auto_accept')
    .select('*')
    .in('offer_id', offerIds)
  if (error) throw error
  const map: Record<string, AutoAccept> = {}
  for (const row of (data ?? []) as AutoAccept[]) map[row.offer_id] = row
  return map
}

// The seller's auto-accept rule for one offer (or null if none set).
export async function getAutoAccept(offerId: string): Promise<AutoAccept | null> {
  const { data, error } = await supabase
    .from('qr_auto_accept')
    .select('*')
    .eq('offer_id', offerId)
    .maybeSingle()
  if (error) throw error
  return (data as AutoAccept | null) ?? null
}

// Create or re-arm the rule. Clearing the trigger stamps re-arms a rule that
// already fired (it's one-shot). avgPriceLamports is base units (× 1e9 of the
// SOL/SUI value entered in the UI).
export async function setAutoAccept(
  offerId: string,
  quantity: number,
  avgPriceLamports: number,
): Promise<void> {
  const { error } = await supabase.from('qr_auto_accept').upsert({
    offer_id: offerId,
    quantity,
    avg_price: avgPriceLamports,
    triggered_price: null,
    triggered_at: null,
  })
  if (error) throw error
}

export async function clearAutoAccept(offerId: string): Promise<void> {
  const { error } = await supabase
    .from('qr_auto_accept')
    .delete()
    .eq('offer_id', offerId)
  if (error) throw error
}
