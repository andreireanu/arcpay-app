export default function SolIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="solIconGrad" x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill="url(#solIconGrad)" />
      <g fill="#fff">
        <path d="M7.6 14.6c.1-.1.3-.2.4-.2h8.1c.2 0 .3.3.2.4l-1.5 1.5c-.1.1-.3.2-.4.2H6.3c-.2 0-.3-.3-.2-.4l1.5-1.5z" />
        <path d="M7.6 7.5c.1-.1.3-.2.4-.2h8.1c.2 0 .3.3.2.4l-1.5 1.5c-.1.1-.3.2-.4.2H6.3c-.2 0-.3-.3-.2-.4l1.5-1.5z" />
        <path d="M16.4 11c-.1-.1-.3-.2-.4-.2H7.9c-.2 0-.3.3-.2.4l1.5 1.5c.1.1.3.2.4.2h8.1c.2 0 .3-.3.2-.4L16.4 11z" />
      </g>
    </svg>
  )
}
