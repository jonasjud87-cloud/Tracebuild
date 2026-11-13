import type { SourceViewStatus } from "@/lib/norm-watch/types";

export const STATUS_META: Record<SourceViewStatus, { label: string; pill: string }> = {
  current: { label: "Aktuell", pill: "bg-[#65A88A]/15 text-[#136a40]" },
  update_available: { label: "Neue Fassung", pill: "bg-[#D6A45F]/20 text-[#7a4f00]" },
  missing: { label: "Fehlt", pill: "bg-[#D6A45F]/20 text-[#7a4f00]" },
  error: { label: "Fehler", pill: "bg-[#D87979]/15 text-[#a3201a]" },
  unchecked: { label: "Ungeprüft", pill: "bg-[rgba(21,20,20,.06)] text-[#46464a]" },
  disabled: { label: "Pausiert", pill: "bg-[rgba(21,20,20,.06)] text-[#46464a]" },
};

export const PROVIDER_LABEL = { fedlex: "Fedlex SR", sg: "Gesetzessammlung SG, sGS" } as const;

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function callApi<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Keine Verbindung zum Server.");
  }
  const json = (await res.json().catch(() => null)) as { data?: T | null; error?: string | null } | null;
  if (!res.ok || !json || json.error) throw new Error(json?.error ?? "Aktion fehlgeschlagen.");
  return json.data as T;
}
