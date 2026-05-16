/** Versa logo: a stylized "V" made of two converging git branches.
 *  Left branch is the brand green; right branch picks up the current text
 *  color so the mark adapts to light / dark themes for free.
 *
 *  Iconography: two commits at the top, both branches converging at the
 *  bottom apex — a literal "merge", a literal "V". */
interface Props {
  size?: number
  className?: string
  /** Render the wordmark to the right of the symbol. */
  withWordmark?: boolean
}

export function Logo({ size = 64, className = '', withWordmark = false }: Props) {
  return (
    <span className={`versa-logo ${className}`} aria-label="Versa">
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Left branch — Versa green */}
        <path
          d="M14 16 L32 52"
          stroke="var(--green)"
          strokeWidth={7}
        />
        <circle cx="14" cy="16" r="6" fill="var(--green)" />

        {/* Right branch — contrasts on either theme */}
        <path
          d="M50 16 L32 52"
          stroke="var(--text)"
          strokeWidth={7}
        />
        <circle cx="50" cy="16" r="6" fill="var(--text)" />
      </svg>
      {withWordmark && <span className="versa-wordmark">Versa</span>}
    </span>
  )
}
