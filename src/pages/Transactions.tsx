import { useEffect, useState } from 'react'
import { getTransactionsBySeller } from '../supabase/transactions/transactions'
import type { Transaction } from '../types/transaction'
import AppHeader from '../components/AppHeader'
import TransactionsList from '../components/TransactionsList'
import s from '../styles/dashboard.module.css'

const PAGE_SIZE = 10

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [loadedPage, setLoadedPage] = useState<number | null>(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    let cancelled = false
    getTransactionsBySeller(page, PAGE_SIZE)
      .then(({ transactions, total }) => {
        if (cancelled) return
        setTransactions(transactions)
        setTotal(total)
        setLoadedPage(page)
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [page])

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
          <TransactionsList transactions={transactions} loading={!loaded} />
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
