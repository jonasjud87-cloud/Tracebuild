"use client";

import { useEffect } from "react";
import type { ToastMessage } from "./types";

interface Props {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

const toastConfig = {
  success: {
    bg: "bg-[#65A88A]/15 border-[#65A88A]/40",
    icon: "text-[#65A88A]",
    text: "text-[#9BD0B5]",
  },
  error: {
    bg: "bg-[#D87979]/15 border-[#D87979]/40",
    icon: "text-[#D87979]",
    text: "text-[#EBA5A5]",
  },
  warning: {
    bg: "bg-[#D6A45F]/15 border-[#D6A45F]/40",
    icon: "text-[#D6A45F]",
    text: "text-[#EBC995]",
  },
  info: {
    bg: "bg-[#83A9D0]/15 border-[#83A9D0]/40",
    icon: "text-[#83A9D0]",
    text: "text-[#B3CCE6]",
  },
} as const;

function ToastIcon({ type }: { type: ToastMessage["type"] }) {
  if (type === "success") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.5 7L6.5 9L9.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "error") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M7 4.5V7.5M7 9.5H7.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "warning") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 2L12.5 12H1.5L7 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M7 6V8.5M7 10H7.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 6.5V10M7 4.5H7.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SingleToast({ toast, onRemove }: { toast: ToastMessage; onRemove: (id: string) => void }) {
  const cfg = toastConfig[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border shadow-lg shadow-black/30 min-w-[280px] max-w-sm backdrop-blur-md bg-[#111B2B] ${cfg.bg}`}
      role="alert"
    >
      <span className={`mt-0.5 flex-shrink-0 ${cfg.icon}`}>
        <ToastIcon type={toast.type} />
      </span>
      <p className={`flex-1 text-sm font-medium leading-snug ${cfg.text}`}>
        {toast.message}
      </p>
      <button
        onClick={() => onRemove(toast.id)}
        className={`flex-shrink-0 mt-0.5 opacity-70 hover:opacity-100 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F0C99A] ${cfg.icon}`}
        aria-label="Schließen"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M1.5 1.5L9.5 9.5M9.5 1.5L1.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default function Toast({ toasts, onRemove }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 items-end">
      {toasts.slice(-4).map(toast => (
        <SingleToast key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}
