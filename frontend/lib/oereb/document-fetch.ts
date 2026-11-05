/**
 * Download amtlicher Dokumente. Jeder Nutzer löst indirekt globale Normen aus, deshalb streng:
 * nur https (http nur für belegte Hosts) auf Port 80/443, nur erlaubte Hosts, keine privaten Adressen, Redirects von
 * Hand und je Hop erneut geprüft, Grössenlimit beim Streamen, %PDF-Prüfung, kein Auth-Header.
 * Die URL stammt immer aus `oereb_documents`, nie vom Client. Rest-Risiko DNS-Rebinding zwischen
 * Prüfung und fetch ist bekannt und akzeptiert (nur amtliche Hosts).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isHostAllowed, isHttpAllowed, type ImportFilterRules } from "./import-filter";

const MAX_REDIRECTS = 3;
const TOTAL_TIMEOUT_MS = 90_000;
const REDIRECT_STATUS = new Set([300, 301, 302, 303, 307, 308]);
const PDF_MAGIC = Buffer.from("%PDF-");

export type FetchRejectReason = "host_not_allowed" | "private_address" | "too_large" | "not_pdf" | "too_many_redirects";

export type DocumentFetchResult =
  | { kind: "ok"; bytes: Buffer; etag: string | null; lastModified: string | null }
  | { kind: "not_modified" }
  | { kind: "rejected"; reason: FetchRejectReason; detail: string }
  | { kind: "failed"; detail: string };

export interface DocumentFetchOptions {
  rules: ImportFilterRules;
  canton: string;
  etag?: string | null;
  lastModified?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Für Tests. */
  fetchImpl?: typeof fetch;
  lookupImpl?: (host: string) => Promise<string[]>;
}

// ── Adressen ─────────────────────────────────────────────────────────────────

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** IPv6 in acht Gruppen; eingebettetes IPv4 wird umgerechnet. Ungültig: null. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, v4.index) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const [head, tail, more] = s.split("::");
  if (more !== undefined) return null;
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = s.includes("::") ? 8 - h.length - t.length : 0;
  if (fill < 0) return null;
  const parts = [...h, ...Array<string>(fill).fill("0"), ...t].map((x) => parseInt(x, 16));
  return parts.length === 8 && parts.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? parts : null;
}

function embeddedV4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** Private, Loopback, Link-Local, CGNAT, ULA, Multicast. Im Zweifel: gesperrt. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip.split("%")[0]);
  if (family === 4) return isPrivateV4(ip);
  if (family !== 6) return true;
  const g = expandV6(ip);
  if (!g) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true; // :: und ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // Link-Local, Site-Local
  if ((g[0] & 0xff00) === 0xff00) return true; // Multicast
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // Dokumentation
  const mapped = g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0);
  if (mapped || (g[0] === 0x64 && g[1] === 0xff9b)) return isPrivateV4(embeddedV4(g[6], g[7]));
  if (g[0] === 0x2002) return isPrivateV4(embeddedV4(g[1], g[2]));
  return false;
}

// ── URL und Redirects ────────────────────────────────────────────────────────

/** Schema, Port, Zugangsdaten, Host. Null = in Ordnung. */
export function checkDocumentUrl(
  url: URL,
  rules: ImportFilterRules,
  canton: string
): { reason: FetchRejectReason; detail: string } | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { reason: "host_not_allowed", detail: `Schema ${url.protocol} ist nicht erlaubt` };
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { reason: "host_not_allowed", detail: `Port ${url.port} ist nicht erlaubt` };
  }
  if (url.username || url.password) {
    return { reason: "host_not_allowed", detail: "URL mit Zugangsdaten ist nicht erlaubt" };
  }
  if (!isHostAllowed(url.hostname, rules, canton)) {
    return { reason: "host_not_allowed", detail: `Host ${url.hostname} steht nicht auf der Liste` };
  }
  if (url.protocol === "http:" && !isHttpAllowed(url.hostname, rules)) {
    return { reason: "host_not_allowed", detail: `${url.hostname}: nur https erlaubt` };
  }
  return null;
}

/** Von https nach http nur auf demselben Host (VD leitet so um). */
export function isRedirectAllowed(from: URL, to: URL): boolean {
  if (from.protocol === "https:" && to.protocol === "http:") return from.hostname === to.hostname;
  return true;
}

async function defaultLookup(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((r) => r.address);
}

// ── Abruf ────────────────────────────────────────────────────────────────────

async function readBody(res: Response, maxBytes: number): Promise<DocumentFetchResult> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: "rejected", reason: "too_large", detail: `${declared} Bytes, erlaubt sind ${maxBytes}` };
  }
  if (!res.body) return { kind: "rejected", reason: "not_pdf", detail: "Antwort ohne Inhalt" };

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let magicChecked = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      total += chunk.length;
      if (total > maxBytes) {
        return { kind: "rejected", reason: "too_large", detail: `über ${maxBytes} Bytes` };
      }
      if (!magicChecked && total >= PDF_MAGIC.length) {
        if (!Buffer.concat(chunks).subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
          return { kind: "rejected", reason: "not_pdf", detail: "Inhalt beginnt nicht mit %PDF-" };
        }
        magicChecked = true;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (!magicChecked) return { kind: "rejected", reason: "not_pdf", detail: "Inhalt beginnt nicht mit %PDF-" };
  return {
    kind: "ok",
    bytes: Buffer.concat(chunks, total),
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

export async function fetchDocument(rawUrl: string, opts: DocumentFetchOptions): Promise<DocumentFetchResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const resolve = opts.lookupImpl ?? defaultLookup;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? TOTAL_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;

  const headers: Record<string, string> = { Accept: "application/pdf,*/*;q=0.5" };
  if (opts.etag) headers["If-None-Match"] = opts.etag;
  if (opts.lastModified) headers["If-Modified-Since"] = opts.lastModified;

  try {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { kind: "rejected", reason: "host_not_allowed", detail: "Ungültige URL" };
    }

    for (let hop = 0; ; hop++) {
      const bad = checkDocumentUrl(url, opts.rules, opts.canton);
      if (bad) return { kind: "rejected", ...bad };

      let addresses: string[];
      try {
        addresses = await resolve(url.hostname);
      } catch (e) {
        return { kind: "failed", detail: `DNS: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        return { kind: "rejected", reason: "private_address", detail: `${url.hostname} zeigt auf eine gesperrte Adresse` };
      }

      const res = await doFetch(url.toString(), { headers, redirect: "manual", signal, cache: "no-store" });

      if (REDIRECT_STATUS.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        const location = res.headers.get("location");
        if (!location) return { kind: "failed", detail: `HTTP ${res.status} ohne Location` };
        if (hop >= MAX_REDIRECTS) {
          return { kind: "rejected", reason: "too_many_redirects", detail: `mehr als ${MAX_REDIRECTS} Weiterleitungen` };
        }
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          return { kind: "failed", detail: "Weiterleitung auf eine ungültige URL" };
        }
        if (!isRedirectAllowed(url, next)) {
          return { kind: "rejected", reason: "host_not_allowed", detail: `Wechsel auf http über fremden Host ${next.hostname}` };
        }
        url = next;
        continue;
      }
      if (res.status === 304) {
        await res.body?.cancel().catch(() => undefined);
        return { kind: "not_modified" };
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { kind: "failed", detail: `HTTP ${res.status}` };
      }
      return await readBody(res, opts.rules.max_pdf_bytes);
    }
  } catch (e) {
    return { kind: "failed", detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}
