import { useEffect, useState } from 'react'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { getTransactionsBySeller, getTransactionsByBuyer } from '../supabase/transactions/transactions'
import { getCurrentRole } from '../supabase/auth/auth'
import type { Transaction } from '../types/transaction'
import AppHeader from '../components/AppHeader'
import TransactionsList from '../components/TransactionsList'
import s from '../styles/dashboard.module.css'

const PAGE_SIZE = 10

export default function Transactions() {
  const { primaryWallet } = useDynamicContext()
  const walletAddress = primaryWallet?.address
  const role = getCurrentRole()

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [loadedPage, setLoadedPage] = useState<number | null>(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (!walletAddress) return
    let cancelled = false
    // Same view, different scoping: a buyer sees their own purchases
    // (buyer_wallet), a seller sees transactions on their own offers
    // (seller_wallet). Neither relies on RLS for the perspective.
    const load =
      role === 'buyer'
        ? getTransactionsByBuyer(walletAddress, page, PAGE_SIZE)
        : getTransactionsBySeller(walletAddress, page, PAGE_SIZE)
    load
      .then(({ transactions, total }) => {
        if (cancelled) return
        setTransactions(transactions)
        setTotal(total)
        setLoadedPage(page)
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [page, role, walletAddress])

  // Loading whenever the data on screen isn't for the page we're requesting —
  // derived rather than a synchronous setState, so paging never flashes stale rows.
  const loaded = loadedPage === page
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className={s.page}>
      <AppHeader />
      <main className={s.content}>
        <section className={s.bottomPanel}>
          <h2 className={s.sectionTitle}>Transactions</h2>
          <TransactionsList
            transactions={transactions}
            loading={!loaded}
            walletLabel={role === 'buyer' ? 'Your wallet' : 'From wallet'}
          />
          {loaded && total > 0 && (
            <div className={s.pager}>
              <span className={s.pagerInfo}>
                Page {page + 1} of {pageCount}
              </span>
              <button
                className={s.pagerBtn}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Prev
              </button>
              <button
                className={s.pagerBtn}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
              >
                Next
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
