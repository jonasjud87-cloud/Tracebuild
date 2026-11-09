"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import css from "./AnnouncementBanner.module.css";

export type BannerType = "info" | "warning" | "maintenance" | "critical";

export interface BannerItem {
  id: string;
  title: string;
  message: string;
  type: BannerType;
  dismissible: boolean;
  updatedAt?: string;
}

const MAX_VISIBLE = 3;
const REFRESH_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;
const STORAGE_PREFIX = "tb-announcement-dismissed:";

const STYLES: Record<BannerType, { box: string; icon: string; title: string; label: string }> = {
  info: { box: "border-l-[#cbbfae]", icon: "text-[#151414]", title: "text-[#151414]", label: "Information" },
  warning: { box: "border-l-[#d9a441]", icon: "text-[#7a4f00]", title: "text-[#151414]", label: "Warnung" },
  maintenance: { box: "border-l-[#cbbfae]", icon: "text-[#151414]", title: "text-[#151414]", label: "Wartung" },
  critical: { box: "border-l-[#b42318]", icon: "text-[#b42318]", title: "text-[#151414]", label: "Kritisch" },
};

function TypeIcon({ type }: { type: BannerType }) {
  const props = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (type === "maintenance") {
    return (
      <svg {...props}>
        <path d="M14.7 6.3a4 4 0 00-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 005.1-5.4l-2.4 2.4-2.3-.7-.7-2.3 2.4-2.4z" />
      </svg>
    );
  }
  if (type === "warning") {
    return (
      <svg {...props}>
        <path d="M12 4l9 16H3L12 4z" />
        <path d="M12 10v4M12 17h.01" />
      </svg>
    );
  }
  if (type === "critical") {
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5M12 16h.01" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function AnnouncementBannerView({
  items,
  onDismiss,
  className,
}: {
  items: BannerItem[];
  onDismiss?: (item: BannerItem) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  const visible = items.slice(0, MAX_VISIBLE);
  const rest = items.length - visible.length;

  return (
    <div className={`space-y-2 [font-family:inherit] ${className ?? ""}`}>
      {visible.map(item => {
        const s = STYLES[item.type];
        return (
          <div
            key={item.id}
            role={item.type === "critical" ? "alert" : "status"}
            className={`${css.item} flex items-start gap-3 rounded-2xl border border-l-[5px] border-[rgba(21,20,20,0.08)] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(21,20,20,0.04),0_10px_30px_rgba(21,20,20,0.07)] ${s.box}`}
          >
            <span className={`mt-0.5 flex-shrink-0 ${s.icon}`}>
              <TypeIcon type={item.type} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[15px] font-semibold leading-snug ${s.title}`} style={{ overflowWrap: "anywhere" }}>
                <span className="sr-only">{s.label}: </span>
                {item.title}
              </p>
              <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-[#46464a]" style={{ overflowWrap: "anywhere" }}>
                {item.message}
              </p>
            </div>
            {item.dismissible && onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss(item)}
                aria-label="Schliessen"
                className={`mt-0.5 flex-shrink-0 rounded-md p-1 opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414] ${s.icon}`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
      {rest > 0 && (
        <p className="inline-block rounded-full bg-[rgba(203,191,174,0.32)] px-3 py-1 text-[13px] font-medium text-[#3d372e]">
          und {rest} weitere {rest === 1 ? "Hinweis" : "Hinweise"}
        </p>
      )}
    </div>
  );
}

function storageKey(item: BannerItem) {
  return `${STORAGE_PREFIX}${item.id}:${item.updatedAt ?? ""}`;
}

function isDismissed(item: BannerItem): boolean {
  if (!item.dismissible) return false;
  try {
    return window.localStorage.getItem(storageKey(item)) === "1";
  } catch {
    return false;
  }
}

function pruneDismissed(current: BannerItem[]) {
  try {
    const ids = new Set(current.map(i => i.id));
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX) && !ids.has(key.slice(STORAGE_PREFIX.length).split(":")[0])) stale.push(key);
    }
    stale.forEach(key => window.localStorage.removeItem(key));
  } catch {
    return;
  }
}

export default function AnnouncementBanner() {
  const [items, setItems] = useState<BannerItem[]>([]);
  const [dismissedNow, setDismissedNow] = useState<Set<string>>(new Set());

  const lastLoadRef = useRef(0);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const started = Date.now();
    if (started - lastLoadRef.current < MIN_GAP_MS) return;
    lastLoadRef.current = started;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++seqRef.current;
    try {
      const res = await fetch("/api/v1/announcements", { cache: "no-store", signal: controller.signal });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: BannerItem[] | null };
      if (seq !== seqRef.current || !Array.isArray(json.data)) return;
      setItems(json.data);
      pruneDismissed(json.data);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    const onFocus = () => {
      load();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      abortRef.current?.abort();
      lastLoadRef.current = 0;
    };
  }, [load]);

  const handleDismiss = useCallback((item: BannerItem) => {
    try {
      window.localStorage.setItem(storageKey(item), "1");
    } catch {
      return;
    } finally {
      setDismissedNow(prev => new Set(prev).add(storageKey(item)));
    }
  }, []);

  const visible = items.filter(i => !dismissedNow.has(storageKey(i)) && !isDismissed(i));
  if (visible.length === 0) return null;

  return <AnnouncementBannerView items={visible} onDismiss={handleDismiss} className="mb-1" />;
}
