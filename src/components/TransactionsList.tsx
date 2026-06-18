import type { Transaction } from '../types/transaction'
import s from '../styles/dashboard.module.css'

interface TransactionsListProps {
  transactions: Transaction[]
  loading: boolean
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function shortWallet(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}

function currencyOf(tx: Transaction) {
  return tx.chain === 'sui' ? 'SUI' : 'SOL'
}

export default function TransactionsList({ transactions, loading }: TransactionsListProps) {
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
              <span className={s.coListLabel}>From wallet</span>
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
                  tx.source === 'buy' ? s.coListSourceBuy : s.coListSourceCounter
                }`}
              >
                {tx.source === 'buy' ? 'direct buy' : 'offer'}
              </span>
            </div>
            <div className={s.coListStatusSlot}>
              <span className={`${s.statusBadge} ${s.statusConfirmed}`}>confirmed</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
