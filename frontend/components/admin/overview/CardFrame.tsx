"use client";

import { useId, type ReactNode } from "react";

export type Resource<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tba-sand,#F0C99A)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111B2B]";

interface CardProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  variant?: "default" | "flat" | "strong";
  children: ReactNode;
}

const variantClass = { default: "tba-glass", flat: "tba-glass tba-glass--flat", strong: "tba-glass tba-glass--strong" } as const;

export function Card({ title, subtitle, action, className = "", variant = "default", children }: CardProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${variantClass[variant]} h-full min-w-0 overflow-hidden rounded-[20px] p-5 sm:p-6 ${className}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-[var(--tba-text,#F4F3F0)]">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-[var(--tba-text-2,#A7AFBA)]">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function CardSkeleton({ rows = 3, height = "h-9" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`${height} animate-pulse rounded-lg bg-white/[0.06] motion-reduce:animate-none`} />
      ))}
    </div>
  );
}

export function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-[#D87979]/30 bg-[#D87979]/10 p-4">
      <p className="text-sm text-[#EBA1A1]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={`rounded-full bg-[image:var(--tba-grad,linear-gradient(135deg,#F0C99A,#B07D3E))] px-4 py-1.5 text-xs font-semibold text-[#0B1220] transition-opacity hover:opacity-90 ${focusRing}`}
      >
        Erneut versuchen
      </button>
    </div>
  );
}
