"use client";

import { useId, type ReactNode } from "react";

export type Resource<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#151414]";

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
    <section aria-labelledby={id} className={`${variantClass[variant]} tba-card tba-card--static h-full min-w-0 overflow-hidden rounded-[20px] p-5 sm:p-6 ${className}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="text-[17px] font-bold text-[var(--tba-text,#151414)]">{title}</h2>
          {subtitle && <p className="mt-1 text-[13px] text-[var(--tba-text-2,#46464a)]">{subtitle}</p>}
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
        <div key={i} className={`${height} animate-pulse rounded-lg bg-[rgba(21,20,20,.05)] motion-reduce:animate-none`} />
      ))}
    </div>
  );
}

export function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-[#b42318]/30 bg-[#fde7e5] p-4">
      <p className="text-sm text-[#a3201a]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={`tba-btn rounded-xl bg-[#151414] hover:bg-[#2e2e30] px-4 py-2 text-[13px] font-semibold text-white ${focusRing}`}
      >
        Erneut versuchen
      </button>
    </div>
  );
}
