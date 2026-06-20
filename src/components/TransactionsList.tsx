import type { Transaction } from '../types/transaction'
import { formatDate, formatTime, shortWallet } from '../utils/format'
import s from '../styles/dashboard.module.css'

interface TransactionsListProps {
  transactions: Transaction[]
  loading: boolean
  // Label for the wallet column — "From wallet" for the seller (the buyer's
  // wallet), "Your wallet" on the buyer's own dashboard.
  walletLabel?: string
}

function currencyOf(tx: Transaction) {
  return tx.chain === 'sui' ? 'SUI' : 'SOL'
}

function statusOf(tx: Transaction): { label: string; canceled: boolean } {
  if (tx.status === 'seller_canceled') return { label: 'seller canceled', canceled: true }
  if (tx.status === 'buyer_canceled') return { label: 'you canceled', canceled: true }
  return { label: 'confirmed', canceled: false }
}

export default function TransactionsList({ transactions, loading, walletLabel = 'From wallet' }: TransactionsListProps) {
  return (
    <div className={s.coList}>
      {loading ? (
        <p className={s.offersEmpty}>Loading…</p>
      ) : transactions.length === 0 ? (
        <p className={s.offersEmpty}>No transactions yet.</p>
      ) : (
        transactions.map((tx) => (
          <div key={tx.id} className={s.coListRow}>
            <div className={s.coListName}>
              <div className={s.coListOfferIcon}>
                <img src="/favicon.svg" alt="" />
              </div>
              <span className={s.coListValue}>{tx.offer_name}</span>
            </div>
            <div className={s.coListCol}>
              <span className={s.coListLabel}>{walletLabel}</span>
              <span className={s.coListValue}>{shortWallet(tx.buyer_wallet)}</span>
            </div>
            <div className={s.coListCol}>
              <span className={s.coListLabel}>{formatDate(tx.created_at)}</span>
              <span className={s.coListValue}>{formatTime(tx.created_at)}</span>
            </div>
            <div className={s.coListCol}>
              <span className={s.coListLabel}>Fee</span>
              <span className={s.coListValue}>
                {tx.fee_amount > 0 ? `${(tx.fee_amount / 1e9).toFixed(4)} ${currencyOf(tx)}` : '—'}
              </span>
            </div>
            <span className={s.coListValueBold}>
              {(tx.seller_amount / 1e9).toFixed(4)} {currencyOf(tx)}
            </span>
            <div className={s.coListSourceSlot}>
              <span
                className={`${s.coListSourceBadge} ${
                  tx.source === 'buy'
                    ? s.coListSourceBuy
                    : tx.source === 'auto_confirmed'
                      ? s.coListSourceAuto
                      : s.coListSourceCounter
                }`}
              >
                {tx.source === 'buy'
                  ? 'direct buy'
                  : tx.source === 'auto_confirmed'
                    ? 'auto offer'
                    : 'offer'}
              </span>
            </div>
            <div className={s.coListStatusSlot}>
              {(() => {
                const st = statusOf(tx)
                return (
                  <span className={`${s.statusBadge} ${st.canceled ? s.statusCanceled : s.statusConfirmed}`}>
                    {st.label}
                  </span>
                )
              })()}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
