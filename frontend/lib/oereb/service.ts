/**
 * Findet Basis-URL, Sprache und Format des ÖREB-Dienstes eines Kantons.
 *
 * Basis-URL in dieser Reihenfolge:
 *  1. Env OEREB_BASE_URL_<KT>
 *  2. oereb_services.base_url_override
 *  3. In-Memory-Cache (24 h) und oereb_services.base_url (geprüft, höchstens 7 Tage alt)
 *  4. KNOWN_BASES
 *  5. swisstopo-Layer (oereb_extract_pdf, dann oereb_webservice), erst nach Prüfung gecacht
 *
 * Eine Basis aus Stufe 4 wird nur ersetzt, wenn sie mit 404 oder Verbindungsfehler ausfällt
 * (rediscoverOerebService). Nie als Sperre oder Basis verwenden: oereb_status_de (SO, TI
 * «geplant 2021» sind produktiv), oereb_webservice ungeprüft (bei GL, SH, ZG, JU falsch),
 * versions.serviceEndpointBase (interne Hosts bei AI, AR, SG).
 *
 * Fehlt die Tabelle oereb_services (Migration nicht eingespielt): nur In-Memory.
 */
import { findByEgrid, type StandAttributes } from "../geoadmin/parcel";
import { OerebNoCadastreError } from "./errors";
import { oerebRequest } from "./http";
import { KNOWN_BASES, PRESET_LANGUAGES, XML_ONLY_CANTONS } from "./service-quirks";
import { xmlToObject } from "./xml";

export type OerebFormat = "json" | "xml";

export interface OerebService {
  baseUrl: string;
  language: string;
  format: OerebFormat;
  authHeader?: { name: string; value: string };
  source: "fixed" | "env" | "override" | "cache" | "known" | "discovered";
}

export interface OerebServiceRow {
  base_url_override: string | null;
  base_url: string | null;
  language: string | null;
  format: string | null;
  verified_at: string | null;
}

export interface OerebServiceStore {
  load(canton: string): Promise<OerebServiceRow | null>;
  save(canton: string, patch: Partial<OerebServiceRow>): Promise<void>;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFIED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ROW_TTL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8_000;

interface CacheEntry {
  baseUrl?: string;
  language?: string;
  format?: OerebFormat;
  at: number;
}

const memory = new Map<string, CacheEntry>();
const rowCache = new Map<string, { row: OerebServiceRow | null; at: number }>();

/** Nur für Tests. */
export function resetOerebServiceCache(): void {
  memory.clear();
  rowCache.clear();
}

function remember(canton: string, patch: Omit<CacheEntry, "at">): void {
  const current = memory.get(canton);
  const fresh = current && Date.now() - current.at < CACHE_TTL_MS ? current : undefined;
  memory.set(canton, { ...fresh, ...patch, at: Date.now() });
}

function recall(canton: string): CacheEntry | undefined {
  const entry = memory.get(canton);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= CACHE_TTL_MS) {
    memory.delete(canton);
    return undefined;
  }
  return entry;
}

// Dynamischer Import: Dieses Modul bleibt ohne Supabase testbar, und ohne Konfiguration
// (Tests, Konformitätslauf) arbeitet es rein aus dem Speicher.
const supabaseStore: OerebServiceStore = {
  async load(canton) {
    if (!process.env.SUPABASE_SERVICE_KEY) return null;
    try {
      const { createAdminClient } = await import("../supabase/admin");
      const { data, error } = await createAdminClient()
        .from("oereb_services")
        .select("base_url_override, base_url, language, format, verified_at")
        .eq("canton", canton)
        .maybeSingle();
      return error ? null : ((data as OerebServiceRow | null) ?? null);
    } catch {
      return null;
    }
  },
  async save(canton, patch) {
    if (!process.env.SUPABASE_SERVICE_KEY) return;
    try {
      const { createAdminClient } = await import("../supabase/admin");
      await createAdminClient()
        .from("oereb_services")
        .upsert({ canton, ...patch }, { onConflict: "canton" });
    } catch {
      // Fehlende Tabelle oder Ausfall: der In-Memory-Stand genügt.
    }
  },
};

async function loadRow(canton: string, store: OerebServiceStore): Promise<OerebServiceRow | null> {
  const cached = rowCache.get(canton);
  if (cached && Date.now() - cached.at < ROW_TTL_MS) return cached.row;
  const row = await store.load(canton);
  rowCache.set(canton, { row, at: Date.now() });
  return row;
}

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Format "Header-Name: Wert". Der Wert erscheint nie in Logs. */
export function parseAuthHeader(raw: string | undefined): { name: string; value: string } | undefined {
  if (!raw) return undefined;
  const colon = raw.indexOf(":");
  if (colon <= 0) return undefined;
  const name = raw.slice(0, colon).trim();
  const value = raw.slice(colon + 1).trim();
  return /^[\w-]+$/.test(name) && value ? { name, value } : undefined;
}

/** Kandidaten für die Basis-URL aus dem Layer, ungeprüft: oereb_extract_pdf vor oereb_webservice. */
export function deriveBaseCandidates(attrs: StandAttributes): string[] {
  const out: string[] = [];
  const add = (url: string) => {
    const base = trimBase(url);
    if (/^https?:\/\//i.test(base) && !out.includes(base)) out.push(base);
  };
  const pdf = attrs.oereb_extract_pdf?.trim();
  if (pdf) {
    const cut = pdf.toLowerCase().indexOf("/extract/");
    if (cut > 0) add(pdf.slice(0, cut));
  }
  const service = attrs.oereb_webservice?.trim();
  if (service) {
    const noQuery = service.split(/[?#]/)[0];
    const cut = noQuery.toLowerCase().indexOf("/extract/");
    add(cut > 0 ? noQuery.slice(0, cut) : noQuery);
  }
  return out;
}

function parseAny(text: string): unknown {
  const body = text.replace(/^﻿/, "").trim();
  if (body.startsWith("<")) return xmlToObject(body);
  return JSON.parse(body);
}

async function probe(canton: string, url: string, signal?: AbortSignal, authHeader?: OerebService["authHeader"]): Promise<unknown> {
  const result = await oerebRequest(url, {
    what: `ÖREB-Dienst ${canton}`,
    canton,
    signal,
    authHeader,
    timeoutMs: PROBE_TIMEOUT_MS,
    retries: 0,
    accept: url.includes("/xml") ? "application/xml" : "application/json",
  });
  return result.kind === "ok" ? parseAny(result.text) : null;
}

/** {base}/versions/json, dann /versions/xml: 200 und erkennbarer Inhalt. */
export async function verifyBase(canton: string, base: string, signal?: AbortSignal): Promise<OerebFormat | null> {
  for (const format of ["json", "xml"] as const) {
    try {
      const doc = await probe(canton, `${base}/versions/${format}`, signal);
      if (JSON.stringify(doc ?? "").includes("supportedVersion")) return format;
    } catch {
      // Nächstes Format versuchen.
    }
  }
  return null;
}

/** `de` falls angeboten, sonst die erste Sprache. Null, wenn das Dokument keine nennt. */
export function pickLanguage(capabilities: unknown): string | null {
  if (typeof capabilities !== "object" || capabilities === null) return null;
  const keyMatches = (key: string, name: string) => key.toLowerCase().replace(/^.*:/, "") === name;
  let root = capabilities as Record<string, unknown>;
  for (const [key, value] of Object.entries(root)) {
    if (keyMatches(key, "getcapabilitiesresponse") && typeof value === "object" && value !== null) {
      root = value as Record<string, unknown>;
      break;
    }
  }
  const entry = Object.entries(root).find(([key]) => keyMatches(key, "language"));
  if (!entry) return null;
  const languages = (Array.isArray(entry[1]) ? entry[1] : [entry[1]])
    .filter((l): l is string => typeof l === "string" && l.trim() !== "")
    .map((l) => l.trim().toLowerCase());
  if (!languages.length) return null;
  return languages.includes("de") ? "de" : languages[0];
}

async function resolveLanguage(
  canton: string,
  baseUrl: string,
  format: OerebFormat,
  row: OerebServiceRow | null,
  store: OerebServiceStore,
  signal?: AbortSignal,
  authHeader?: OerebService["authHeader"]
): Promise<string> {
  const preset = PRESET_LANGUAGES[canton];
  if (preset) return preset;
  const cached = recall(canton)?.language;
  if (cached) return cached;
  if (row?.language) {
    remember(canton, { language: row.language });
    return row.language;
  }
  const formats: OerebFormat[] = format === "xml" ? ["xml"] : ["json", "xml"];
  for (const f of formats) {
    try {
      const language = pickLanguage(await probe(canton, `${baseUrl}/capabilities/${f}`, signal, authHeader));
      if (language) {
        remember(canton, { language });
        await store.save(canton, { language });
        return language;
      }
    } catch {
      // Sprache ist kein Grund für einen Abbruch: unten Standard.
    }
  }
  // Nicht cachen: beim nächsten Abruf erneut versuchen. LANG wird nie weggelassen (BS: 500).
  return "de";
}

export interface ResolveOptions {
  egrid?: string;
  signal?: AbortSignal;
  store?: OerebServiceStore;
}

async function discover(
  canton: string,
  opts: ResolveOptions,
  store: OerebServiceStore,
  exclude?: string
): Promise<{ baseUrl: string; format: OerebFormat } | null> {
  // Der Layer führt nur Schweizer EGRIDs (FL ohne EGRID): find wäre langsam und leer.
  if (!opts.egrid || !opts.egrid.toUpperCase().startsWith("CH")) return null;
  let rows: StandAttributes[];
  try {
    rows = await findByEgrid(opts.egrid, { signal: opts.signal });
  } catch {
    return null;
  }
  for (const attrs of rows) {
    for (const base of deriveBaseCandidates(attrs)) {
      if (base === exclude) continue;
      const verified = await verifyBase(canton, base, opts.signal);
      if (!verified) continue;
      const format: OerebFormat = XML_ONLY_CANTONS.has(canton) ? "xml" : verified;
      remember(canton, { baseUrl: base, format });
      await store.save(canton, { base_url: base, format, verified_at: new Date().toISOString() });
      return { baseUrl: base, format };
    }
  }
  return null;
}

function configuredFormat(canton: string, row: OerebServiceRow | null): OerebFormat {
  const remembered = recall(canton)?.format ?? (row?.format === "xml" || row?.format === "json" ? row.format : undefined);
  return remembered ?? (XML_ONLY_CANTONS.has(canton) ? "xml" : "json");
}

/** Wirft OerebNoCadastreError, wenn kein Dienst auffindbar ist. */
export async function resolveOerebService(canton: string, opts: ResolveOptions = {}): Promise<OerebService> {
  const code = canton.trim().toUpperCase();
  const store = opts.store ?? supabaseStore;
  const row = await loadRow(code, store);
  const authHeader = parseAuthHeader(process.env[`OEREB_${code}_AUTH_HEADER`]);

  let baseUrl: string | undefined;
  let source: OerebService["source"] = "known";
  const env = process.env[`OEREB_BASE_URL_${code}`]?.trim();
  const verifiedAt = row?.verified_at ? Date.parse(row.verified_at) : NaN;
  if (env) {
    baseUrl = env;
    source = "env";
  } else if (row?.base_url_override?.trim()) {
    baseUrl = row.base_url_override;
    source = "override";
  } else if (recall(code)?.baseUrl) {
    baseUrl = recall(code)?.baseUrl;
    source = "cache";
  } else if (row?.base_url && Date.now() - verifiedAt <= VERIFIED_MAX_AGE_MS) {
    baseUrl = row.base_url;
    source = "cache";
  } else if (KNOWN_BASES[code]) {
    baseUrl = KNOWN_BASES[code];
    source = "known";
  } else {
    const found = await discover(code, opts, store);
    if (!found) throw new OerebNoCadastreError(`Für ${code} ist kein ÖREB-Dienst auffindbar`);
    baseUrl = found.baseUrl;
    source = "discovered";
  }

  const trimmed = trimBase(baseUrl as string);
  const format = configuredFormat(code, row);
  const language = await resolveLanguage(code, trimmed, format, row, store, opts.signal, authHeader);
  return { baseUrl: trimmed, language, format, authHeader, source };
}

/** Eine bekannte Basis ist ausgefallen (404, Verbindungsfehler): über den Layer neu ermitteln. */
export async function rediscoverOerebService(
  canton: string,
  failed: OerebService,
  opts: ResolveOptions = {}
): Promise<OerebService | null> {
  const code = canton.trim().toUpperCase();
  const store = opts.store ?? supabaseStore;
  const found = await discover(code, opts, store, failed.baseUrl);
  if (!found) return null;
  return { ...failed, baseUrl: found.baseUrl, format: found.format, source: "discovered" };
}

/** JSON wurde mit 406 oder 415 abgelehnt: künftig XML. */
export async function rememberOerebFormat(canton: string, format: OerebFormat, store: OerebServiceStore = supabaseStore): Promise<void> {
  remember(canton, { format });
  await store.save(canton, { format });
}
