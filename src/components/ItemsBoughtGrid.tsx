import { useState } from 'react'
import type { Offer } from '../types/offer'
import SuiIcon from '../assets/icons/SuiIcon'
import SolIcon from '../assets/icons/SolIcon'
import LinkIcon from '../assets/icons/LinkIcon'
import s from '../styles/dashboard.module.css'

interface ItemsBoughtGridProps {
  title: string
  offers: Offer[]
  /** When set, only the first N render until "Show more" is clicked. */
  initialVisible?: number
  /** Called with the offer id when a card body is clicked — used to focus the
   *  tabs panel on that item. */
  onItemClick?: (offerId: string) => void
  /** The currently focused offer, highlighted as selected. */
  selectedId?: string | null
}

// Read-only product cards for the buyer dashboard's "Items bought" section. Same
// card look as the seller's ProductsGrid but with no owner actions — the buyer
// can only open the public pay page (which shows live stock + status), so the
// card links there.
export default function ItemsBoughtGrid({
  title,
  offers,
  initialVisible,
  onItemClick,
  selectedId,
}: ItemsBoughtGridProps) {
  const [visibleCount, setVisibleCount] = useState(initialVisible ?? offers.length)

  const shown = initialVisible != null ? offers.slice(0, visibleCount) : offers
  const showMore = initialVisible != null && offers.length > visibleCount

  function statusClass(status: Offer['status']) {
    if (status === 'active') return s.statusActive
    if (status === 'paused') return s.statusPaused
    if (status === 'canceled') return s.statusCanceled
    if (status === 'sold') return s.statusSold
    return ''
  }

  return (
    <section className={s.offersSection}>
      <div className={s.offersSectionHeader}>
        <h2 className={s.sectionTitle}>{title}</h2>
      </div>

      {offers.length === 0 ? (
        <p className={s.offersEmpty}>
          Nothing bought yet. Items you purchase will show up here.
        </p>
      ) : (
        <>
          <div className={s.offersGrid}>
            {shown.map((offer) => {
              const selected = offer.id === selectedId
              return (
              <div
                key={offer.id}
                className={`${s.offerCard} ${selected ? s.offerCardSelected : ''}`}
                onClick={() => onItemClick?.(offer.id)}
              >
                <div className={s.offerCardThumb}>
                  <img src="/favicon.svg" alt="" />
                </div>
                <div className={s.offerCardBody}>
                  <div className={s.offerCardHead}>
                    <div className={s.offerCardInfo}>
                      <h3 className={s.offerName}>{offer.name}</h3>
                      {offer.description && (
                        <p className={s.offerDescription}>{offer.description}</p>
                      )}
                    </div>
                    {selected ? (
                      <span className={s.offerCardSelectedBadge}>✓ Selected</span>
                    ) : (
                      <span className={`${s.statusBadge} ${statusClass(offer.status)}`}>
                        {offer.status}
                      </span>
                    )}
                  </div>
                  <div className={s.offerCardBottom}>
                    <div className={s.offerCardPrice}>
                      {offer.chain === 'sui' ? <SuiIcon size={18} /> : <SolIcon size={18} />}
                      <span>
                        {(offer.price_lamports / 1e9).toFixed(4)}{' '}
                        {offer.chain === 'sui' ? 'SUI' : 'SOL'}
                      </span>
                    </div>
                    {!offer.unlimited && (
                      <span className={`${s.offerCardPill} ${s.offerCardAvailPill}`}>
                        {`${offer.quantity - offer.quantity_sold} of ${offer.quantity} Available`}
                      </span>
                    )}
                    {/* The card opens the buyer dashboard; the link icon is the
                        only escape hatch to the item's public pay page. */}
                    <a
                      href={`/pay/${offer.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={s.offerCardIconBtn}
                      title="View pay page"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <LinkIcon />
                    </a>
                  </div>
                </div>
              </div>
              )
            })}
          </div>

          {showMore && (
            <div className={s.gridFooter}>
              <button
                className={s.showMoreBtn}
                onClick={() => setVisibleCount((c) => c + (initialVisible ?? 0))}
              >
                Show more
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
