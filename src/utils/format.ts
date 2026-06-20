export function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}.${d.getFullYear()}`
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 12-hour time with the viewer's UTC offset appended (e.g. "02:30 PM GMT+2"), so
// the timestamp is unambiguous across time zones.
export function formatTimeWithZone(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const h = Math.floor(Math.abs(offsetMin) / 60)
  const m = Math.abs(offsetMin) % 60
  return `${time} GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

export function shortWallet(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}
