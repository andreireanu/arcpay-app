import { useEffect, useState } from 'react'
import type { CounterOffer } from '../types/counterOffer'
import { formatDate, formatTimeWithZone, shortWallet } from '../utils/format'
import s from '../styles/dashboard.module.css'

interface CounterOffersListProps {
  counterOffers: CounterOffer[]
  // Seller mode (accept / hide / batch-select). Optional so the same detailed
  // rows can be reused in buyer mode (see onCancel).
  accepting?: boolean
  onAccept?: (ids: string[]) => void
  onHide?: (ids: string[]) => void
  // When set, the list switches to BUYER mode: no green selection summary and no
  // accept/hide/checkbox — each row instead gets a Cancel button (the buyer
  // withdrawing their own counter offer). Receives the whole counter offer so
  // the dispatcher can route the cancel to the right chain.
  onCancel?: (counterOffer: CounterOffer) => void
  cancelingId?: string | null
  // When set, each row shows the name of the offer it belongs to. Used on the
  // seller dashboard, where counter offers from every listing are pooled, so the
  // seller knows what they're accepting, and on the buyer dashboard so the buyer
  // sees which item each offer is for. Omitted on a single offer's page, where
  // the name is implicit. Display-only: the on-chain accept never links the
  // counter offers to a listing, so the anonymity is unaffected.
  offerNameFor?: (offerId: string) => string
}

function currencyOf(co: CounterOffer) {
  return co.chain === 'sui' ? 'SUI' : 'SOL'
}

function isExpiringSoon(expiryIso: string) {
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  return new Date(expiryIso).getTime() - Date.now() < sevenDays
}

// Shared counter-offers view: the green selection summary (Accept all / Accept
// selected, Hide selected) plus the per-row list with checkboxes. Used both by a
// single offer's page (OfferDetail) and the seller dashboard, where it pools
// counter offers across *all* of the seller's offers.
//
// On the dashboard each row shows the offer name (via offerNameFor) so the seller
// knows what they're accepting; on a single offer's page the name is implicit and
// omitted. Either way the on-chain accept never links the counter offers to a
// listing, so batching them stays anonymous on-chain. Columns are flex-weighted
// (plus a fixed-width controls block) so rows line up on both pages.
export default function CounterOffersList({
  counterOffers,
  accepting = false,
  onAccept,
  onHide,
  onCancel,
  cancelingId,
  offerNameFor,
}: CounterOffersListProps) {
  const buyerMode = onCancel != null
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Drop ids whose rows have left the list (accepted / hidden / canceled) so the
  // selection set doesn't accumulate stale entries.
  const coIdKey = counterOffers.map((co) => co.id).join(',')
  useEffect(() => {
    const present = new Set(coIdKey ? coIdKey.split(',') : [])
    setSelectedIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (present.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [coIdKey])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Intersect the selection with the rows still present (some may have been
  // hidden, accepted, or canceled since they were checked) rather than syncing
  // a derived state in an effect — stale ids simply don't count.
  const activeOffers = counterOffers.filter((co) => co.status === 'active')
  const selectedOffers = counterOffers.filter((co) => selectedIds.has(co.id))
  const hasSelection = selectedOffers.length > 0
  const displayed = hasSelection ? selectedOffers : activeOffers
  const totalAmount = displayed.reduce(
    (sum, co) => sum + co.seller_amount + co.fee_amount,
    0,
  )
  const totalQty = displayed.reduce((sum, co) => sum + co.quantity, 0)
  const avgPrice = totalQty > 0 ? totalAmount / totalQty : 0
  // A seller's offers are all on their active chain, so the pooled rows share one
  // currency; fall back to SOL only when the list is empty.
  const summaryCurrency = counterOffers[0] ? currencyOf(counterOffers[0]) : 'SOL'

  return (
    <>
      {!buyerMode && (
      <div className={s.selectionSummary}>
        <div className={s.selectionSummaryStats}>
          <div className={`${s.selectionSummaryItem} ${s.selectionSummaryItemFirst}`}>
            <span className={s.selectionSummaryLabel}>
              {hasSelection ? 'Total selected offers' : 'Total active offers'}
            </span>
            <span className={s.selectionSummaryValue}>{displayed.length}</span>
          </div>
          <div className={s.selectionSummaryItem}>
            <span className={s.selectionSummaryLabel}>Avg. Price</span>
            <span className={s.selectionSummaryValue}>
              {(avgPrice / 1_000_000_000).toFixed(4)} {summaryCurrency}
            </span>
          </div>
          <div className={s.selectionSummaryItem}>
            <span className={s.selectionSummaryLabel}>Total to receive</span>
            <span className={`${s.selectionSummaryValue} ${s.selectionSummaryTotal}`}>
              {(totalAmount / 1_000_000_000).toFixed(4)} {summaryCurrency}
            </span>
          </div>
        </div>
        <div className={s.selectionSummaryActions}>
          <button
            className={s.summaryHideButton}
            disabled={!hasSelection}
            onClick={() => onHide?.(selectedOffers.map((co) => co.id))}
          >
            Hide selected
          </button>
          <button
            className={s.summaryAcceptButton}
            disabled={accepting || displayed.length === 0}
            onClick={() => onAccept?.(displayed.map((co) => co.id))}
          >
            {accepting
              ? 'Accepting…'
              : hasSelection
                ? 'Accept selected'
                : 'Accept all'}
          </button>
        </div>
      </div>
      )}
      <div className={s.coList}>
        {[...counterOffers]
          .sort((a, b) => {
            if (a.status === 'confirmed' && b.status !== 'confirmed') return 1
            if (a.status !== 'confirmed' && b.status === 'confirmed') return -1
            return (
              b.seller_amount + b.fee_amount - (a.seller_amount + a.fee_amount)
            )
          })
          .map((co) => {
            const confirmed = co.status === 'confirmed'
            const expiring = isExpiringSoon(co.expiry_at)
            const profitSol = (co.seller_amount / 1_000_000_000).toFixed(4)
            const totalSol = (
              (co.seller_amount + co.fee_amount) /
              1_000_000_000
            ).toFixed(4)
            return (
              <div
                key={co.id}
                className={`${s.coListRow} ${confirmed ? s.counterOfferRowConfirmed : ''}`}
              >
                {offerNameFor && (
                  <div className={s.coListName}>
                    <div className={s.coListOfferIcon}>
                      <img src="/favicon.svg" alt="" />
                    </div>
                    <span className={s.coListValue}>{offerNameFor(co.offer_id)}</span>
                  </div>
                )}
                <div className={s.coListCol}>
                  <span className={s.coListLabel}>From wallet</span>
                  <span className={s.coListValue}>{shortWallet(co.buyer_wallet)}</span>
                </div>
                <div className={s.coListCol}>
                  <span className={s.coListLabel}>{formatDate(co.created_at)}</span>
                  <span className={s.coListValue}>{formatTimeWithZone(co.created_at)}</span>
                </div>
                <div className={s.coListCol}>
                  <span className={s.coListLabel}>Expire on</span>
                  <span className={s.coListValue}>{formatDate(co.expiry_at)}</span>
                </div>
                <div className={s.coListCol}>
                  <span className={s.coListLabel}>Profit</span>
                  <span className={s.coListValue}>{profitSol} {currencyOf(co)}</span>
                </div>
                <span className={s.coListValueBold}>{totalSol} {currencyOf(co)}</span>
                <div className={s.coListControls}>
                  {confirmed ? (
                    <span className={s.counterOfferStatusConfirmed}>confirmed</span>
                  ) : buyerMode ? (
                    <>
                      <span
                        className={
                          expiring
                            ? s.counterOfferStatusExpiring
                            : s.counterOfferStatusActive
                        }
                      >
                        {expiring ? 'expiring soon' : 'active'}
                      </span>
                      <button
                        className={s.hideOfferBtn}
                        disabled={cancelingId === co.id}
                        onClick={() => onCancel?.(co)}
                      >
                        {cancelingId === co.id ? 'Canceling…' : 'Cancel'}
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className={
                          expiring
                            ? s.counterOfferStatusExpiring
                            : s.counterOfferStatusActive
                        }
                      >
                        {expiring ? 'expiring soon' : 'active'}
                      </span>
                      <button
                        className={s.hideOfferBtn}
                        onClick={() => onHide?.([co.id])}
                      >
                        Hide
                      </button>
                      <button
                        className={s.acceptOfferBtn}
                        disabled={accepting}
                        onClick={() => onAccept?.([co.id])}
                      >
                        Accept
                      </button>
                      <input
                        type="checkbox"
                        className={s.counterOfferCheckbox}
                        checked={selectedIds.has(co.id)}
                        onChange={() => toggleSelect(co.id)}
                      />
                    </>
                  )}
                </div>
              </div>
            )
          })}
      </div>
    </>
  )
}
