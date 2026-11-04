"use client";

import { useId, type ReactNode } from "react";

export type Resource<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9] focus-visible:ring-offset-2 focus-visible:ring-offset-[#172540]";

interface CardProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Card({ title, subtitle, action, className = "", children }: CardProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`min-w-0 rounded-2xl border border-[rgba(60,63,68,0.5)] bg-[#172540] p-5 ${className}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-[#ABAEBB]">{subtitle}</p>}
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
        <div key={i} className={`${height} animate-pulse rounded-lg bg-[#1E2D4A] motion-reduce:animate-none`} />
      ))}
    </div>
  );
}

export function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
      <p className="text-sm text-red-300">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={`rounded-lg bg-[#2862D7] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#3A72E6] ${focusRing}`}
      >
        Erneut versuchen
      </button>
    </div>
  );
}
