import { statusMeta, type StatusTone } from "./utils";

function Glyph({ tone }: { tone: StatusTone }) {
  const common = { width: 11, height: 11, viewBox: "0 0 12 12", fill: "none", "aria-hidden": true } as const;
  if (tone === "running") {
    return (
      <svg {...common} className="animate-spin">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.6" />
        <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === "orphaned") {
    return (
      <svg {...common}>
        <path d="M6 1.5 11 10.5H1L6 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M6 5v2.4M6 8.8v.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === "error") {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="4.8" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.2 4.2 7.8 7.8M7.8 4.2 4.2 7.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === "done") {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="4.8" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3.9 6.1 5.4 7.6 8.2 4.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="6" cy="6" r="4.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.8 6h4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export default function StatusBadge({ status, orphaned }: { status: string; orphaned: boolean }) {
  const meta = statusMeta(status, orphaned);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.badge}`}>
      <Glyph tone={meta.tone} />
      {meta.label}
    </span>
  );
}
