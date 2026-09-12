"use client";

/* ── Buttons ─────────────────────────────────────────────────────────────── */

const btnBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "14px 26px",
  borderRadius: "var(--tb-r-btn)",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  textDecoration: "none",
  cursor: "pointer",
  border: "1px solid transparent",
  transition:
    "filter var(--tb-dur-base) var(--tb-ease-out), border-color var(--tb-dur-base) var(--tb-ease-out), background var(--tb-dur-base) var(--tb-ease-out), transform var(--tb-dur-base) var(--tb-ease-out)",
};

export function GradientButton({
  href,
  children,
  onClick,
}: {
  href?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="tb-btn-grad"
      style={{
        ...btnBase,
        background: "var(--tb-accent-gradient)",
        color: "var(--tb-on-accent)",
        border: "none",
        isolation: "isolate",
      }}
    >
      {children}
    </a>
  );
}

export function GhostButton({
  href,
  children,
  onClick,
}: {
  href?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="tb-btn-ghost"
      style={{
        ...btnBase,
        background: "rgba(12,20,32,0.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        borderColor: "var(--tb-border-strong)",
        color: "var(--tb-text)",
      }}
    >
      {children}
    </a>
  );
}

/* ── Eyebrow / section label ─────────────────────────────────────────────── */

export function Eyebrow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12.5,
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--tb-lavender)",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* ── Word-by-word clip-mask reveal for big headlines ────────────────────── */
/* CSS-driven (see globals.css .tb-word-*): runs at first paint, no JS/hydration
   dependency, degrades to plain visible text. */

export function WordReveal({
  text,
  accentWord,
  delay = 0,
  style,
}: {
  text: string;
  accentWord?: string;
  delay?: number;
  style?: React.CSSProperties;
}) {
  const words = text.split(" ");
  return (
    <span style={{ display: "inline", ...style }}>
      {words.map((w, i) => {
        const isAccent =
          accentWord != null && w.replace(/[.,!?;:()]/g, "") === accentWord;
        const d = delay + i * 0.04;
        return (
          // the space sits between the inline-block masks, not inside one
          // (trailing whitespace inside an inline-block is trimmed → words jam)
          <span key={i}>
            <span className="tb-word-mask">
              <span className="tb-word-inner" style={{ animationDelay: `${d}s` }}>
                {isAccent ? (
                  <span className="tb-word-accent" style={{ animationDelay: `${d + 0.2}s` }}>
                    {w}
                  </span>
                ) : (
                  w
                )}
              </span>
            </span>
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </span>
  );
}
