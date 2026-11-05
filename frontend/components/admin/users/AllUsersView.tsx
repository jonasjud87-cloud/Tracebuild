"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OrgUser, OrgUsersGroup } from "@/app/api/v1/admin/all-users/route";
import ConfirmDialog from "@/components/admin/analyses/ConfirmDialog";
import { maskEmail } from "@/lib/mask-email";
import { fallbackError, formatFull, formatRelative } from "./format";

type RowStatus = "active" | "pending" | "blocked";
type SortKey = "activity" | "name" | "org";
type ActionKind = "block" | "unblock" | "reset";

interface Row extends OrgUser {
  orgId: string;
  orgName: string;
  rowStatus: RowStatus;
}

interface Pending {
  kind: ActionKind;
  user: Row;
}

interface Props {
  groups: OrgUsersGroup[];
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void> | void;
  onToast: (message: string, type?: "success" | "error" | "info") => void;
  onInvite: () => void;
  onResendInvite: (orgId: string, email: string, role: string, name: string | null) => void;
  resendingId: string | null;
  roleLabels: Record<string, string>;
}

const STATUS_STYLE: Record<RowStatus, { label: string; cls: string; dot: string }> = {
  active: { label: "Aktiv", cls: "bg-emerald-500/15 text-emerald-400", dot: "bg-emerald-500" },
  pending: { label: "Ausstehend", cls: "bg-amber-500/15 text-amber-400", dot: "bg-amber-400" },
  blocked: { label: "Gesperrt", cls: "bg-red-500/15 text-red-300", dot: "bg-red-400" },
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9] focus-visible:ring-offset-2 focus-visible:ring-offset-[#172540]";

const controlCls =
  "w-full rounded-xl border border-[rgba(133,166,233,0.25)] bg-[rgba(23,37,64,0.6)] px-3 py-2.5 text-sm text-white focus:border-[#2862D7] focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40";

const TH = "py-3.5 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7B8299]";

function activityTime(u: Row): number {
  const iso = u.lastActivityAt ?? u.lastSignInAt;
  return iso ? new Date(iso).getTime() : 0;
}

function RowMenu({
  user,
  isSelf,
  disabled,
  onSelect,
  triggerRef,
}: {
  user: Row;
  isSelf: boolean;
  disabled: boolean;
  onSelect: (kind: ActionKind) => void;
  triggerRef: (el: HTMLButtonElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }, []);

  function toggle() {
    if (open) { close(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function dismiss() { setOpen(false); }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); close(true); }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, close]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  }

  const blockKind: ActionKind = user.blocked ? "unblock" : "block";
  const itemCls = "block w-full px-3 py-2 text-left text-sm focus:outline-none focus-visible:bg-[#1E2D4A] disabled:cursor-not-allowed disabled:opacity-50";
  const label = user.name || user.email;

  return (
    <>
      <button
        ref={el => { btnRef.current = el; triggerRef(el); }}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Aktionen für ${label}`}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={e => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); toggle(); } }}
        className={`rounded-lg p-1.5 text-[#ABAEBB] transition-colors hover:bg-[#1E2D4A] hover:text-white disabled:opacity-40 ${focusRing}`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Aktionen für ${label}`}
          onKeyDown={onMenuKey}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-50 w-64 overflow-hidden rounded-xl border border-[rgba(60,63,68,0.6)] bg-[#0E111B] py-1 shadow-2xl"
        >
          {user.rowStatus === "pending" ? (
            <p className="px-3 py-2 text-xs text-[#ABAEBB]">Einladung noch nicht angenommen.</p>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={isSelf && !user.blocked}
                onClick={() => { setOpen(false); onSelect(blockKind); }}
                className={`${itemCls} ${user.blocked ? "text-emerald-300" : "text-red-300"}`}
              >
                {user.blocked ? "Entsperren" : "Sperren"}
              </button>
              {isSelf && !user.blocked && (
                <p className="px-3 pb-2 text-[11px] text-[#7B8299]">Das eigene Konto kann nicht gesperrt werden.</p>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onSelect("reset"); }}
                className={`${itemCls} text-white`}
              >
                Passwort zurücksetzen
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default function AllUsersView({
  groups,
  loading,
  error,
  onReload,
  onToast,
  onInvite,
  onResendInvite,
  resendingId,
  roleLabels,
}: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RowStatus>("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("activity");
  const [selfId, setSelfId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const triggers = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const lastTrigger = useRef<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setSelfId(data.user?.id ?? null)).catch(() => setSelfId(null));
  }, []);

  const rows = useMemo<Row[]>(
    () =>
      groups.flatMap(g =>
        g.users.map(u => ({
          ...u,
          orgId: g.orgId,
          orgName: g.orgName,
          rowStatus: (u.blocked ? "blocked" : u.status) as RowStatus,
        })),
      ),
    [groups],
  );

  const orgOptions = useMemo(
    () => groups.map(g => ({ id: g.orgId, name: g.orgName })).sort((a, b) => a.name.localeCompare(b.name, "de")),
    [groups],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter(
      u =>
        (statusFilter === "all" || u.rowStatus === statusFilter) &&
        (orgFilter === "all" || u.orgId === orgFilter) &&
        (!q ||
          u.email.toLowerCase().includes(q) ||
          (u.name ?? "").toLowerCase().includes(q) ||
          u.orgName.toLowerCase().includes(q)),
    );
    return list.sort((a, b) => {
      if (sort === "name") return (a.name || a.email).localeCompare(b.name || b.email, "de");
      if (sort === "org") return a.orgName.localeCompare(b.orgName, "de") || (a.name || a.email).localeCompare(b.name || b.email, "de");
      return activityTime(b) - activityTime(a);
    });
  }, [rows, search, statusFilter, orgFilter, sort]);

  const filtersActive = search.trim() !== "" || statusFilter !== "all" || orgFilter !== "all";

  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setOrgFilter("all");
  }

  function openAction(kind: ActionKind, user: Row) {
    lastTrigger.current = user.id;
    setPending({ kind, user });
  }

  function closeDialog() {
    if (busy) return;
    setPending(null);
    const id = lastTrigger.current;
    requestAnimationFrame(() => {
      if (id) triggers.current.get(id)?.focus();
    });
  }

  function focusTriggerOrRegion() {
    const id = lastTrigger.current;
    requestAnimationFrame(() => {
      const el = id ? triggers.current.get(id) : null;
      if (el && el.isConnected) el.focus();
      else regionRef.current?.focus();
    });
  }

  async function runAction() {
    if (!pending) return;
    const { kind, user } = pending;
    setBusy(true);
    setBusyId(user.id);
    try {
      const url =
        kind === "reset"
          ? `/api/v1/admin/users/${encodeURIComponent(user.id)}/password-reset`
          : `/api/v1/admin/users/${encodeURIComponent(user.id)}/block`;
      const res = await fetch(url, {
        method: "POST",
        headers: kind === "reset" ? undefined : { "Content-Type": "application/json" },
        body: kind === "reset" ? undefined : JSON.stringify({ blocked: kind === "block" }),
      });
      const json = (await res.json().catch(() => null)) as { data: { email?: string } | null; error?: string | null } | null;
      if (!res.ok || !json || json.error || !json.data) {
        onToast(json?.error || fallbackError(res.status), "error");
        if (res.status === 403 || res.status === 404 || res.status === 409) {
          setPending(null);
          await onReload();
          focusTriggerOrRegion();
        }
        return;
      }
      const name = user.name || user.email;
      if (kind === "reset") onToast(`Passwort-Reset-E-Mail an ${json.data.email ?? "den Nutzer"} gesendet.`, "success");
      else onToast(kind === "block" ? `${name} wurde gesperrt.` : `${name} wurde entsperrt.`, "success");
      setPending(null);
      await onReload();
      focusTriggerOrRegion();
    } catch {
      onToast("Netzwerkfehler. Bitte erneut versuchen.", "error");
    } finally {
      setBusy(false);
      setBusyId(null);
    }
  }

  const dialog = (() => {
    if (!pending) return null;
    const { kind, user } = pending;
    const name = user.name || user.email;
    if (kind === "block")
      return {
        title: `${name} sperren?`,
        description: "Der Nutzer kann sich nicht mehr anmelden und verliert den Zugriff auf TraceBuild. Du kannst die Sperre jederzeit aufheben.",
        confirmLabel: "Sperren",
        tone: "danger" as const,
      };
    if (kind === "unblock")
      return {
        title: `${name} entsperren?`,
        description: "Der Nutzer kann sich danach wieder anmelden.",
        confirmLabel: "Entsperren",
        tone: "primary" as const,
      };
    return {
      title: "Passwort zurücksetzen?",
      description: `Es wird eine E-Mail zum Zurücksetzen des Passworts an ${maskEmail(user.email)} gesendet.`,
      confirmLabel: "E-Mail senden",
      tone: "primary" as const,
    };
  })();

  const total = rows.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-semibold text-white">Alle Nutzer</h2>
          <p className="mt-0.5 text-xs text-[#7B8299]" aria-live="polite">
            {loading && total === 0 ? "Wird geladen …" : `${visible.length} von ${total} Nutzern in ${groups.length} ${groups.length === 1 ? "Organisation" : "Organisationen"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onInvite}
          className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#2862D7] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#2862D7]/25 transition-all hover:bg-[#3470E8] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9]"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M5.5 1V10M1 5.5H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Nutzer einladen
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Name, E-Mail oder Organisation …"
          aria-label="Nutzer suchen"
          className={`${controlCls} placeholder:text-[#7B8299]`}
        />
        <select aria-label="Nach Status filtern" value={statusFilter} onChange={e => setStatusFilter(e.target.value as "all" | RowStatus)} className={controlCls}>
          <option value="all">Alle Status</option>
          <option value="active">Aktiv</option>
          <option value="pending">Ausstehend</option>
          <option value="blocked">Gesperrt</option>
        </select>
        <select aria-label="Nach Organisation filtern" value={orgFilter} onChange={e => setOrgFilter(e.target.value)} className={controlCls}>
          <option value="all">Alle Organisationen</option>
          {orgOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select aria-label="Sortierung" value={sort} onChange={e => setSort(e.target.value as SortKey)} className={controlCls}>
          <option value="activity">Letzte Aktivität</option>
          <option value="name">Name</option>
          <option value="org">Organisation</option>
        </select>
      </div>

      {loading && total === 0 && !error ? (
        <div role="status" aria-label="Nutzer werden geladen" className="space-y-px overflow-hidden rounded-2xl border border-[rgba(60,63,68,0.5)] bg-[#172540]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse border-b border-[rgba(60,63,68,0.3)] bg-[rgba(30,45,74,0.4)] last:border-0" />
          ))}
        </div>
      ) : error && total === 0 ? (
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <p className="text-sm font-medium text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => { void onReload(); }}
            disabled={loading}
            className="mt-3 rounded-xl border border-[rgba(133,166,233,0.35)] px-4 py-2 text-sm font-medium text-[#85A6E9] hover:bg-[#1E2D4A] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9]"
          >
            {loading ? "Lädt …" : "Erneut versuchen"}
          </button>
        </div>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-[rgba(60,63,68,0.5)] bg-[#172540] p-12 text-center">
          <p className="text-sm font-medium text-[#ABAEBB]">Noch keine Nutzer vorhanden</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-[rgba(60,63,68,0.5)] bg-[#172540] p-12 text-center">
          <p className="text-sm font-medium text-[#ABAEBB]">Keine Nutzer gefunden</p>
          {filtersActive && (
            <button type="button" onClick={resetFilters} className="mt-2 rounded text-sm text-[#85A6E9] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9]">
              Filter zurücksetzen
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[rgba(60,63,68,0.5)] bg-[#172540]">
          {error && (
            <div role="alert" className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-5 py-2.5 text-xs text-red-300">
              <span>{error}</span>
              <button type="button" onClick={() => { void onReload(); }} className="rounded font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
                Erneut versuchen
              </button>
            </div>
          )}
          <div ref={regionRef} role="region" aria-label="Alle Nutzer" tabIndex={0} className={`overflow-x-auto ${focusRing}`}>
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-[rgba(60,63,68,0.4)] bg-[rgba(23,37,64,0.5)]">
                  <th scope="col" className={`${TH} px-5`}>Nutzer</th>
                  <th scope="col" className={TH}>Organisation</th>
                  <th scope="col" className={TH}>Rolle</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH}>Letzte Aktivität</th>
                  <th scope="col" className="w-14 px-5 py-3.5"><span className="sr-only">Aktionen</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(u => {
                  const s = STATUS_STYLE[u.rowStatus];
                  const isSelf = selfId !== null && u.id === selfId;
                  const rowBusy = busyId === u.id;
                  const resendKey = `${u.orgId}:${u.email}`;
                  return (
                    <tr key={`${u.orgId}:${u.id}`} aria-busy={rowBusy} className={`border-b border-[rgba(60,63,68,0.3)] transition-colors last:border-0 hover:bg-[#1E2D4A]/60 ${rowBusy ? "opacity-60" : ""}`}>
                      <th scope="row" className="max-w-[260px] px-5 py-3 text-left font-normal">
                        <div className="truncate font-medium text-white" title={u.name ?? undefined}>
                          {u.name ?? "—"}
                          {isSelf && <span className="ml-2 rounded-full bg-[#2862D7]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#85A6E9]">Du</span>}
                        </div>
                        <div className="truncate text-xs text-[#ABAEBB]" title={u.email}>{u.email}</div>
                      </th>
                      <td className="max-w-[180px] truncate px-3 py-3 text-[#ABAEBB]" title={u.orgName}>{u.orgName}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          u.role === "org_admin" || u.role === "super_admin" ? "bg-[#2862D7]/10 text-[#85A6E9]" : "bg-[rgba(60,63,68,0.5)] text-[#ABAEBB]"
                        }`}>
                          {roleLabels[u.role] ?? u.role}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
                          {s.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-[#ABAEBB]">
                        <time dateTime={u.lastActivityAt ?? undefined} title={formatFull(u.lastActivityAt)}>
                          {formatRelative(u.lastActivityAt)}
                        </time>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {u.rowStatus === "pending" && (
                            <button
                              type="button"
                              onClick={() => onResendInvite(u.orgId, u.email, u.role, u.name)}
                              disabled={resendingId === resendKey}
                              className="whitespace-nowrap rounded text-xs font-medium text-[#85A6E9] transition-colors hover:text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9]"
                              title="Einladung erneut senden"
                            >
                              {resendingId === resendKey ? "…" : "Erneut einladen"}
                            </button>
                          )}
                          <RowMenu
                            user={u}
                            isSelf={isSelf}
                            disabled={rowBusy}
                            onSelect={kind => openAction(kind, u)}
                            triggerRef={el => { triggers.current.set(u.id, el); }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pending && dialog && (
        <ConfirmDialog
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          tone={dialog.tone}
          busy={busy}
          onConfirm={runAction}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
