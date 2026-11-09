"use client";

import { useEffect, useRef } from "react";

interface Props {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
  tone?: "danger" | "primary";
}

const TONE_CLS = {
  danger: "bg-[#b42318] hover:bg-[#8f1c13] focus-visible:ring-[#b42318]",
  primary: "tba-btn bg-[#151414] hover:bg-[#2e2e30] !text-white focus-visible:ring-[#151414]",
};

export default function ConfirmDialog({ title, description, confirmLabel, busy, onConfirm, onClose, tone = "danger" }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busyRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center tba-scrim px-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc" className="tba-pop w-full max-w-sm tba-glass tba-glass--modal rounded-2xl p-7">
        <h2 id="confirm-title" className="mb-2 text-center text-base font-bold text-[#151414]">{title}</h2>
        <p id="confirm-desc" className="mb-6 text-center text-sm text-[#46464a]">{description}</p>
        <div className="flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border-[1.5px] border-[#151414] py-2.5 text-sm font-medium text-[#151414] hover:bg-[#151414] hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414]"
          >
            Zurück
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 ${TONE_CLS[tone]}`}
          >
            {busy ? "Bitte warten …" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
