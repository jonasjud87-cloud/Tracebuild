"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

interface OrgHit { id: string; name: string; subtitle: string; href: string }
interface UserHit { id: string; name: string; email: string; role: string; orgId: string; orgName: string; href: string }
interface ProjectHit { id: string; name: string; orgId: string; orgName: string; href: string }
interface SearchResult { orgs: OrgHit[]; users: UserHit[]; projects: ProjectHit[] }

type ItemKind = "org" | "user" | "project";
interface Item { key: string; kind: ItemKind; title: string; sub: string; href: string }

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super-Admin",
  org_admin: "Org-Admin",
  project_manager: "Projektleiter",
  member: "Mitglied",
};

const GROUPS: { kind: ItemKind; label: string }[] = [
  { kind: "org", label: "Organisationen" },
  { kind: "user", label: "Nutzer" },
  { kind: "project", label: "Projekte" },
];

function KindIcon({ kind }: { kind: ItemKind }) {
  if (kind === "org") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 14V3.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V14M9.5 6.5h3a1 1 0 0 1 1 1V14M1.5 14h13M5 5.5h2M5 8h2M5 10.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "user") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="5.5" r="2.7" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2.8 13.5c.6-2.4 2.6-3.7 5.2-3.7s4.6 1.3 5.2 3.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.8 4.2a1 1 0 0 1 1-1h3l1.4 1.6h6a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const trimmed = query.trim();
  const tooShort = trimmed.length < 2;

  const items = useMemo<Item[]>(() => {
    if (!result) return [];
    return [
      ...result.orgs.map<Item>(o => ({ key: `org-${o.id}`, kind: "org", title: o.name, sub: o.subtitle, href: o.href })),
      ...result.users.map<Item>(u => ({
        key: `user-${u.id}`,
        kind: "user",
        title: u.name || u.email,
        sub: [u.name ? u.email : "", ROLE_LABELS[u.role] ?? u.role, u.orgName].filter(Boolean).join(" · "),
        href: u.href,
      })),
      ...result.projects.map<Item>(p => ({ key: `project-${p.id}`, kind: "project", title: p.name, sub: p.orgName, href: p.href })),
    ];
  }, [result]);

  const openPalette = useCallback(() => {
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? triggerRef.current;
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    abortRef.current?.abort();
    seqRef.current++;
    setQuery("");
    setResult(null);
    setLoading(false);
    setFailed(false);
    setActive(0);
    const target = returnFocusRef.current && document.contains(returnFocusRef.current) ? returnFocusRef.current : triggerRef.current;
    setTimeout(() => target?.focus(), 0);
  }, []);

  const go = useCallback((href: string) => {
    closePalette();
    router.push(href);
  }, [closePalette, router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
        return;
      }
      if (e.key === "/" && !open && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(document.activeElement)) {
        e.preventDefault();
        openPalette();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openPalette, closePalette]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    const seq = ++seqRef.current;

    if (tooShort) {
      setResult(null);
      setLoading(false);
      setFailed(false);
      return;
    }

    setLoading(true);
    setFailed(false);
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/admin/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Partial<SearchResult>;
        if (seq !== seqRef.current) return;
        setResult({
          orgs: json.orgs ?? [],
          users: json.users ?? [],
          projects: json.projects ?? [],
        });
        setActive(0);
        setLoading(false);
      } catch (e) {
        if ((e as Error).name === "AbortError" || seq !== seqRef.current) return;
        setResult(null);
        setFailed(true);
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, tooShort, open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) setActive(i => (i + 1) % items.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive(i => (i - 1 + items.length) % items.length);
      return;
    }
    if (e.key === "Enter") {
      const item = items[active];
      if (item) {
        e.preventDefault();
        go(item.href);
      }
      return;
    }
    if (e.key === "Tab") {
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const hasResults = items.length > 0;
  let statusText: string | null = null;
  if (tooShort) statusText = "Mindestens 2 Zeichen eingeben, um zu suchen.";
  else if (failed) statusText = "Die Suche ist gerade nicht verfügbar. Bitte erneut versuchen.";
  else if (loading && !hasResults) statusText = "Suche läuft…";
  else if (!loading && result && !hasResults) statusText = "Keine Treffer";

  let runningIndex = 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-label="Suchen (Strg K)"
        className="flex h-9 items-center gap-2 rounded-full border border-[var(--tba-line,rgba(255,255,255,.08))] bg-white/[0.03] px-2.5 text-sm text-[var(--tba-text-2,#A7AFBA)] transition-colors hover:bg-[rgba(41,57,77,.6)] hover:text-[var(--tba-text,#F4F3F0)] sm:px-3.5"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Suchen…</span>
        <kbd className="hidden rounded px-1 text-[11px] font-medium text-[#8E98A6] sm:inline">Strg K</kbd>
      </button>

      {open && createPortal(
        <div className="tba">
        <div
          className="tba-scrim fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]"
          onMouseDown={e => { if (e.target === e.currentTarget) closePalette(); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Globale Suche"
            onKeyDown={onDialogKeyDown}
            className="tba-glass tba-glass--modal w-full max-w-xl border border-[var(--tba-border,#304052)] rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="tba-ring rounded-t-2xl flex items-center gap-3 px-4 border-b border-[var(--tba-line,rgba(255,255,255,.08))]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-[var(--tba-sand,#F0C99A)] flex-shrink-0">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                role="combobox"
                aria-expanded={hasResults}
                aria-controls="global-search-listbox"
                aria-autocomplete="list"
                aria-activedescendant={hasResults ? `global-search-opt-${active}` : undefined}
                aria-label="Organisationen, Nutzer und Projekte durchsuchen"
                placeholder="Organisationen, Nutzer, Projekte suchen…"
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                className="tba-bare flex-1 h-14 bg-transparent text-sm text-[var(--tba-text,#F4F3F0)] placeholder-[#8793A2] outline-none"
              />
              <kbd className="text-[11px] font-medium text-[var(--tba-text-2,#A7AFBA)] border border-[var(--tba-border,#304052)] rounded px-1.5 py-0.5">Esc</kbd>
            </div>

            <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
              <div id="global-search-listbox" role="listbox" aria-label="Suchergebnisse">
                {hasResults && GROUPS.map(group => {
                  const groupItems = items.filter(i => i.kind === group.kind);
                  if (groupItems.length === 0) return null;
                  const headingId = `global-search-group-${group.kind}`;
                  return (
                    <div key={group.kind} role="group" aria-labelledby={headingId}>
                      <div id={headingId} className="px-4 pt-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-[var(--tba-text-2,#A7AFBA)]">
                        {group.label}
                      </div>
                      {groupItems.map(item => {
                        const index = runningIndex++;
                        const selected = index === active;
                        return (
                          <div
                            key={item.key}
                            id={`global-search-opt-${index}`}
                            data-index={index}
                            role="option"
                            aria-selected={selected}
                            onMouseEnter={() => setActive(index)}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => go(item.href)}
                            className={`mx-2 flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${selected ? "bg-[rgba(168,134,91,.2)]" : ""}`}
                          >
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${selected ? "bg-[var(--tba-bronze,#A8865B)] text-[#0B1220]" : "bg-[rgba(168,134,91,.1)] text-[var(--tba-sand,#F0C99A)]"}`}>
                              <KindIcon kind={item.kind} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-[var(--tba-text,#F4F3F0)] truncate">{item.title}</span>
                              {item.sub && <span className="block text-xs text-[var(--tba-text-2,#A7AFBA)] truncate">{item.sub}</span>}
                            </span>
                            {selected && <span className="text-[11px] text-[var(--tba-sand,#F0C99A)] flex-shrink-0">Enter</span>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {statusText && (
                <div
                  role="status"
                  aria-live="polite"
                  className="px-4 py-6 text-center text-sm text-[var(--tba-text-2,#A7AFBA)]"
                >
                  {statusText}
                </div>
              )}
              {!statusText && loading && hasResults && <span className="sr-only" role="status">Aktualisiere Ergebnisse</span>}
            </div>

            <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-[var(--tba-line,rgba(255,255,255,.08))] text-[11px] text-[var(--tba-text-2,#A7AFBA)]">
              <span>↑↓ Navigieren</span>
              <span>Enter Öffnen</span>
              <span>Esc Schließen</span>
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}
    </>
  );
}
