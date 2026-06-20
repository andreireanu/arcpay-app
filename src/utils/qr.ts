import QRCode from 'qrcode'

// Build the offer's pay-page QR as an SVG (with the ArcPay logo centered when the
// favicon fetch succeeds) and trigger a download.
export async function downloadQrSvg(offerName: string, offerId: string): Promise<void> {
  const url = `${window.location.origin}/pay/${offerId}`
  let svg: string = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H',
  })
  try {
    const resp = await fetch('/favicon.svg')
    if (resp.ok) {
      const b64 = btoa(await resp.text())
      const logoData = `data:image/svg+xml;base64,${b64}`
      const match = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/)
      if (match) {
        const w = parseFloat(match[1])
        const h = parseFloat(match[2])
        const logoSize = Math.round(w * 0.22)
        const x = Math.round((w - logoSize) / 2)
        const y = Math.round((h - logoSize) / 2)
        svg = svg.replace(
          '</svg>',
          `<image href="${logoData}" x="${x}" y="${y}" width="${logoSize}" height="${logoSize}"/></svg>`,
        )
      }
    }
  } catch {
    /* download without logo if fetch fails */
  }
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${offerName}-qr.svg`
  a.click()
  URL.revokeObjectURL(a.href)
}
