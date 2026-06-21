export default function InfoIcon({
  size = 16,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
      <path d="M8 7v3.5" stroke="currentColor" strokeLinecap="round" />
      <circle cx="8" cy="5.25" r="0.75" fill="currentColor" />
    </svg>
  )
}
