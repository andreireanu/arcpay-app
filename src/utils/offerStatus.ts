import type { Offer } from '../types/offer'
import s from '../styles/dashboard.module.css'

export function statusClass(status: Offer['status']): string {
  if (status === 'active') return s.statusActive
  if (status === 'paused') return s.statusPaused
  if (status === 'canceled') return s.statusCanceled
  if (status === 'sold') return s.statusSold
  return ''
}
