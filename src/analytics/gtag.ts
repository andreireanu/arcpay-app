import { useEffect } from 'react'

// Set once in index.html; reused here for manual page_view hits.
const MEASUREMENT_ID = 'G-TP0LKCPDF1'

// Who the page view belongs to. The two dashboards already differ by URL; this
// is mainly the differentiator for the buy page, which buyers and sellers share.
export type AnalyticsRole = 'buyer' | 'seller' | 'buy'

type Gtag = (...args: unknown[]) => void

function gtag(): Gtag | null {
  const fn = (window as unknown as { gtag?: Gtag }).gtag
  return typeof fn === 'function' ? fn : null
}

// Fire a GA4 page_view tagged with a role, and set role as a user property so
// the whole session can be segmented by it (buyer vs seller) in GA4.
export function trackPageView(role: AnalyticsRole) {
  const g = gtag()
  if (!g) return
  g('set', 'user_properties', { role })
  g('event', 'page_view', {
    send_to: MEASUREMENT_ID,
    role,
    page_path: window.location.pathname,
    page_location: window.location.href,
    page_title: document.title,
  })
}

// Reports a page_view for the given role when the page mounts.
export function useTrackPageView(role: AnalyticsRole) {
  useEffect(() => {
    trackPageView(role)
  }, [role])
}
