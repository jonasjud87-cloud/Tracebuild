import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header
      className="tba-glass tba-glass--strong mb-5 overflow-hidden px-5 py-5 sm:px-6 sm:py-6"
    >
      <svg
        className="pointer-events-none absolute inset-y-0 right-0 h-full w-[75%] min-w-[320px] max-w-[720px]"
        viewBox="0 0 720 140"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="tba-arc-stroke" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#F0C99A" stopOpacity="0" />
            <stop offset=".5" stopColor="#F0C99A" stopOpacity=".7" />
            <stop offset="1" stopColor="#FDF6EE" stopOpacity=".95" />
          </linearGradient>
          <filter id="tba-arc-glow" x="-10%" y="-60%" width="120%" height="220%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <path d="M120 160C300 140 470 80 690 30" stroke="#F0C99A" strokeOpacity=".4" strokeWidth="9" strokeLinecap="round" filter="url(#tba-arc-glow)" vectorEffect="non-scaling-stroke" />
        <path d="M120 160C300 140 470 80 690 30" stroke="url(#tba-arc-stroke)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tba-text,#F4F3F0)] sm:text-[30px] sm:leading-9">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-[#E4E3E0]">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
