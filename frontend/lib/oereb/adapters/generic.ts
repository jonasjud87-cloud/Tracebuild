/**
 * Generischer ÖREB-Adapter nach swisstopo-Weisung "ÖREB-Kataster: ÖREB-Webservice" (v2).
 *
 * Pro Kanton unterscheiden sich Basis-URL, Sprache und Format (lib/oereb/service.ts); die
 * Signatur ist identisch:
 *   GET {base}/getegrid/{json|xml}/?EN=<E>,<N>                (LV95)
 *   GET {base}/getegrid/{json|xml}/?IDENTDN=<x>&NUMBER=<n>
 *   GET {base}/extract/{json|xml}/?EGRID=<CHxxxxxxxxxxxx>&LANG=<de|fr|it>&GEOMETRY=false
 *
 * Abweichende Formen gleicht normalize.ts vor dem Parser aus. Das Parsing ist bewusst tolerant
 * (Gross-/Kleinschreibung der Schlüssel, `extract` vs. `Extract`, Text-Arrays
 * `[{Language, Text}]`), Fehler dagegen sind laut: jede Störung wird als typisierter
 * OerebError geworfen, nie still weggeschluckt.
 */
import type {
  Concern,
  EgridResolution,
  GetEgridRequest,
  LegalStatus,
  OerebAdapter,
  OerebExtract,
  OerebLawLink,
  OerebTheme,
  ZoneResult,
} from "../types";
import {
  OerebAmbiguousError,
  OerebBaseGoneError,
  OerebError,
  OerebNoEgridError,
  OerebParseError,
  OerebUnreachableError,
} from "../errors";
import { normalizeParcel, resolveParcel } from "../../geoadmin/parcel";
import { oerebRequest } from "../http";
import { normalizeExtract } from "../normalize";
import {
  rediscoverOerebService,
  rememberOerebFormat,
  resolveOerebService,
  type OerebFormat,
  type OerebService,
} from "../service";
import { OTHER_LEGEND_CANTONS, PRESET_LANGUAGES, XML_ONLY_CANTONS, oerebPdfUrl } from "../service-quirks";
import { xmlToObject } from "../xml";

export { OerebAmbiguousError, OerebError, OerebNoEgridError, OerebParseError, OerebUnreachableError };

export const OEREB_THEME_NUTZUNGSPLANUNG = "ch.Nutzungsplanung";

// ── Tolerante Zugriffs-Helfer ────────────────────────────────────────────────

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Liest `obj[name]` — Schlüssel werden case-insensitiv verglichen, erster Treffer gewinnt. */
export function getKey(obj: unknown, ...names: string[]): unknown {
  if (!isDict(obj)) return undefined;
  for (const name of names) {
    if (name in obj) return obj[name];
  }
  const wanted = names.map((n) => n.toLowerCase());
  for (const key of Object.keys(obj)) {
    if (wanted.includes(key.toLowerCase())) return obj[key];
  }
  return undefined;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Mehrsprachige Texte kommen als `[{Language: "de", Text: "…"}]`, gelegentlich als
 * einzelnes Objekt oder schlicht als String. Deutsch wird bevorzugt, sonst der erste
 * vorhandene Eintrag.
 */
export function localizedText(v: unknown, lang = "de"): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() || null;
  const texts: { lang: string | null; text: string | null }[] = [];
  for (const e of asArray(v)) {
    if (typeof e === "string") {
      texts.push({ lang: null, text: e.trim() || null });
    } else if (isDict(e)) {
      texts.push({
        lang: asString(getKey(e, "Language", "lang"))?.toLowerCase() ?? null,
        text: asString(getKey(e, "Text", "text", "value")),
      });
    }
  }
  const preferred = texts.find((t) => t.lang === lang && t.text);
  if (preferred) return preferred.text;
  return texts.find((t) => t.text)?.text ?? null;
}

// Die Weisung nennt die deutschen Codes (inKraft, …); pyramid_oereb-Instanzen wie SG
// liefern die englischen Modellwerte (inForce, …). Beides wird akzeptiert.
export function mapLawStatus(code: unknown): LegalStatus {
  const c = asString(code)?.toLowerCase();
  switch (c) {
    case "inkraft":
    case "inforce":
      return "inForce";
    case "aenderungmitvorwirkung":
    case "changewithpreeffect":
      return "changeWithPreEffect";
    case "aenderungohnevorwirkung":
    case "changewithoutpreeffect":
      return "changeWithoutPreEffect";
    default:
      return "unknown";
  }
}

// ── Verschlankung der Rohdaten ───────────────────────────────────────────────
// Ein echter Auszug ist mehrere MB gross (Logos/QR-Codes als data-URIs, WMS-Karten,
// Geometrien). Für die Ablage in jsonb bleiben nur die fachlichen Felder übrig.

const EXTRACT_DROP_KEYS = new Set(
  [
    "LogoPLRCadastreRef", "FederalLogoRef", "CantonalLogoRef", "MunicipalityLogoRef",
    "QRCodeRef", "Glossary", "GeneralInformation", "Disclaimer", "ExclusionOfLiability",
    "LogoPLRCadastre", "FederalLogo", "CantonalLogo", "MunicipalityLogo", "QRCode",
  ].map((k) => k.toLowerCase())
);
const REAL_ESTATE_DROP_KEYS = new Set(
  ["RestrictionOnLandownership", "PlanForLandRegister", "PlanForLandRegisterMainPage", "Limit"].map((k) =>
    k.toLowerCase()
  )
);
const RESTRICTION_DROP_KEYS = new Set(["Map", "Geometry", "SymbolRef", "Symbol"].map((k) => k.toLowerCase()));

function omitKeys(obj: unknown, drop: Set<string>): unknown {
  if (!isDict(obj)) return obj;
  const out: Dict = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!drop.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

export function slimRestriction(restriction: unknown): unknown {
  return omitKeys(restriction, RESTRICTION_DROP_KEYS);
}

export function slimExtract(extract: unknown): unknown {
  const top = omitKeys(extract, EXTRACT_DROP_KEYS);
  if (!isDict(top)) return top;
  for (const key of Object.keys(top)) {
    if (key.toLowerCase() === "realestate") top[key] = omitKeys(top[key], REAL_ESTATE_DROP_KEYS);
  }
  return top;
}

// ── Parsing GetExtractByIdResponse ───────────────────────────────────────────

interface ThemeRef {
  code: string;
  name: string;
  subTheme: string | null;
}

function parseThemeRef(v: unknown, lang: string): ThemeRef | null {
  const code = asString(getKey(v, "Code"));
  if (!code) return null;
  const name = localizedText(getKey(v, "Text"), lang) ?? code;
  const subTheme = asString(getKey(v, "SubCode", "Subcode")) ?? null;
  return { code, name, subTheme };
}

function parseLawLinks(v: unknown, lang: string): OerebLawLink[] {
  const links: OerebLawLink[] = [];
  for (const lp of asArray(v)) {
    const title = localizedText(getKey(lp, "Title"), lang);
    const url = localizedText(getKey(lp, "TextAtWeb"), lang);
    if (!title && !url) continue;
    const link: OerebLawLink = { title: title ?? url ?? "", url };
    const kind = asString(getKey(getKey(lp, "Type"), "Code"));
    if (kind) link.kind = kind;
    const authority = localizedText(getKey(getKey(lp, "ResponsibleOffice"), "Name"), lang);
    if (authority) link.authority = authority;
    const officialNumber = localizedText(getKey(lp, "OfficialNumber"), lang)?.trim();
    if (officialNumber) link.officialNumber = officialNumber;
    links.push(link);
  }
  return links;
}

function parseAuthority(v: unknown, lang: string): OerebTheme["authority"] {
  if (!isDict(v)) return null;
  const name = localizedText(getKey(v, "Name"), lang);
  const url = localizedText(getKey(v, "OfficeAtWeb"), lang);
  if (!name && !url) return null;
  return { name, url };
}

function parseRestriction(r: unknown, lang: string): OerebTheme | null {
  const theme = parseThemeRef(getKey(r, "Theme"), lang);
  if (!theme) return null;
  const subTheme = theme.subTheme ?? localizedText(getKey(r, "SubTheme"), lang);
  return {
    themeCode: theme.code,
    themeName: theme.name,
    subTheme,
    concern: "affects",
    legalStatus: mapLawStatus(getKey(getKey(r, "Lawstatus", "LawStatus"), "Code")),
    areaPct: asNumber(getKey(r, "PartInPercent")),
    areaM2: asNumber(getKey(r, "AreaShare")),
    typeCode: asString(getKey(r, "TypeCode")),
    legendText: localizedText(getKey(r, "LegendText"), lang),
    lawLinks: parseLawLinks(getKey(r, "LegalProvisions"), lang),
    authority: parseAuthority(getKey(r, "ResponsibleOffice"), lang),
    raw: slimRestriction(r),
  };
}

function themeStub(ref: ThemeRef, concern: Concern, raw: unknown): OerebTheme {
  return {
    themeCode: ref.code,
    themeName: ref.name,
    subTheme: ref.subTheme,
    concern,
    legalStatus: "unknown",
    areaPct: null,
    areaM2: null,
    typeCode: null,
    legendText: null,
    lawLinks: [],
    authority: null,
    raw,
  };
}

/**
 * Wandelt ein GetExtractByIdResponse-Dokument in den OerebExtract-Vertrag um.
 *
 *  - jede RestrictionOnLandownership-Zeile → ein Thema mit concern 'affects' und Details
 *  - ConcernedTheme ohne zugehörige Restriction → 'affects' ohne Details (nichts geht verloren)
 *  - NotConcernedTheme → 'not_affects', ThemeWithoutData → 'no_data' (je Code+SubCode dedupliziert)
 *
 * Wirft OerebParseError, wenn das Dokument nicht als Auszug erkennbar ist.
 */
export function parseExtractResponse(json: unknown, canton: string, lang = "de"): OerebExtract {
  if (!isDict(json)) throw new OerebParseError("ÖREB-Antwort ist kein JSON-Objekt");

  const root = getKey(json, "GetExtractByIdResponse") ?? json;
  const extract = getKey(root, "extract", "Extract") ?? root;
  const realEstate = getKey(extract, "RealEstate");
  if (!isDict(realEstate)) throw new OerebParseError("ÖREB-Antwort enthält kein RealEstate-Element");

  const egrid = asString(getKey(realEstate, "EGRID", "Egrid"));
  if (!egrid) throw new OerebParseError("ÖREB-Antwort enthält keine EGRID");

  const themes: OerebTheme[] = [];
  const affectedCodes = new Set<string>();

  for (const r of asArray(getKey(realEstate, "RestrictionOnLandownership"))) {
    const t = parseRestriction(r, lang);
    if (!t) continue;
    themes.push(t);
    affectedCodes.add(t.themeCode);
  }

  for (const c of asArray(getKey(extract, "ConcernedTheme"))) {
    const ref = parseThemeRef(c, lang);
    if (!ref || affectedCodes.has(ref.code)) continue;
    affectedCodes.add(ref.code);
    themes.push(themeStub(ref, "affects", c));
  }

  const seen = new Set<string>();
  const pushStubs = (list: unknown, concern: Concern) => {
    for (const c of asArray(list)) {
      const ref = parseThemeRef(c, lang);
      if (!ref) continue;
      const key = `${concern}|${ref.code}|${ref.subTheme ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      themes.push(themeStub(ref, concern, c));
    }
  };
  pushStubs(getKey(extract, "NotConcernedTheme"), "not_affects");
  pushStubs(getKey(extract, "ThemeWithoutData"), "no_data");

  // Ein leerer Auszug ist kein Befund: Er würde einen guten ersetzen und im Prompt «keine
  // Einschränkung» behaupten. Jeder echte Auszug listet zumindest die nicht betroffenen Themen.
  if (themes.length === 0) throw new OerebParseError("ÖREB-Antwort enthält keine Themen");

  const municipality =
    localizedText(getKey(realEstate, "MunicipalityName", "Municipality"), lang) ??
    asString(getKey(realEstate, "MunicipalityCode"));
  const bfsNumber = asNumber(getKey(realEstate, "MunicipalityCode"));

  return {
    canton: asString(getKey(realEstate, "Canton")) ?? canton,
    egrid,
    identDn: asString(getKey(realEstate, "IdentDN", "IdentDn")),
    parcelNumber: asString(getKey(realEstate, "Number")),
    municipality,
    bfsNumber: bfsNumber !== null && Number.isInteger(bfsNumber) ? bfsNumber : null,
    themes,
    raw: slimExtract(extract),
  };
}

// ── Parsing GetEGRIDResponse ─────────────────────────────────────────────────

export interface EgridCandidate {
  egrid: string;
  number: string | null;
  identDn: string | null;
  typeCode: string | null; // 'RealEstate' | 'Distinct_and_permanent_rights.BuildingRight' | …
}

const EGRID_PATTERN = /^CH\d{12}$/i;

function egridTypeCode(type: unknown): string | null {
  const code = asString(getKey(type, "Code")) ?? asString(type);
  // .NET-Dienste (GE, VD) liefern den Code als Zahl.
  return code === "0" ? "RealEstate" : code;
}

/** LU: `[{Value: egrid}, {Value: nummer}, {Value: identDN}, {Code: typ}]`, je Grundstück wiederholt. */
function parseOrderedItems(items: unknown[]): EgridCandidate[] {
  const out: EgridCandidate[] = [];
  let current: EgridCandidate | null = null;
  let position = 0;
  for (const item of items) {
    const value = asString(getKey(item, "Value"));
    if (value && EGRID_PATTERN.test(value)) {
      current = { egrid: value.toUpperCase(), number: null, identDn: null, typeCode: null };
      out.push(current);
      position = 0;
    } else if (current && value) {
      if (position === 0) current.number = value;
      else if (position === 1) current.identDn = value;
      position++;
    } else if (current && getKey(item, "Code") !== undefined) {
      current.typeCode = egridTypeCode(item);
    }
  }
  return out;
}

export function parseEgridResponse(json: unknown): EgridCandidate[] {
  if (json === null || json === undefined) return [];
  const root = getKey(json, "GetEGRIDResponse") ?? json;
  const ordered = getKey(root, "OrderedItems");
  if (Array.isArray(ordered)) return parseOrderedItems(ordered);

  const list = asArray(getKey(root, "Item") ?? root);
  const out: EgridCandidate[] = [];
  for (const item of list) {
    // XML (SO, SH): Felder stehen flach nebeneinander, bei mehreren Treffern als parallele Listen.
    const egrids = asArray(getKey(item, "egrid", "EGRID"));
    const numbers = asArray(getKey(item, "number", "Number"));
    const identDns = asArray(getKey(item, "identDN", "IdentDN"));
    const types = asArray(getKey(item, "type", "Type"));
    egrids.forEach((value, i) => {
      const egrid = asString(value);
      if (!egrid) return;
      out.push({
        egrid: egrid.toUpperCase(),
        number: asString(numbers[i]),
        identDn: asString(identDns[i]),
        typeCode: egridTypeCode(types[i]),
      });
    });
  }
  return out;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export type GetEgridInput = GetEgridRequest;

export type ServiceResolver = (
  canton: string,
  opts: { egrid?: string; signal?: AbortSignal }
) => Promise<OerebService | null>;

/**
 * Herkunft des Dienstes: nichts = Auflösung über service.ts; String = feste Basis-URL
 * (leer = nicht konfiguriert, Abruf endet mit 'unreachable'); Funktion = eigener Resolver.
 */
export type ServiceSource = string | null | ServiceResolver;

function fixedResolver(baseUrl: string | null): ServiceResolver {
  const url = baseUrl?.trim().replace(/\/+$/, "");
  return async (canton) =>
    url
      ? {
          baseUrl: url,
          language: PRESET_LANGUAGES[canton] ?? "de",
          format: XML_ONLY_CANTONS.has(canton) ? "xml" : "json",
          source: "fixed",
        }
      : null;
}

function parseBody(text: string, what: string): unknown {
  const body = text.replace(/^﻿/, "").trim();
  if (body.startsWith("<")) return xmlToObject(body);
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new OerebParseError(`${what} liefert kein gültiges JSON`, e);
  }
}

export class GenericOerebAdapter implements OerebAdapter {
  readonly canton: string;
  private readonly resolver: ServiceResolver;

  constructor(canton: string, service?: ServiceSource) {
    this.canton = canton;
    if (typeof service === "function") this.resolver = service;
    else if (service === undefined) this.resolver = (c, opts) => resolveOerebService(c, opts);
    else this.resolver = fixedResolver(service);
  }

  /** Führt einen Abruf aus; fällt eine bekannte Basis aus (404, Verbindung), einmal neu ermitteln. */
  private async withService<T>(
    opts: { egrid?: string; signal?: AbortSignal },
    run: (service: OerebService) => Promise<T>
  ): Promise<T> {
    const service = await this.resolver(this.canton, opts);
    if (!service) throw new OerebUnreachableError(`ÖREB-Basis-URL für ${this.canton} nicht konfiguriert`);
    try {
      return await run(service);
    } catch (e) {
      if (!(e instanceof OerebBaseGoneError) || service.source !== "known") throw e;
      const replacement = await rediscoverOerebService(this.canton, service, opts);
      if (!replacement) throw e;
      return run(replacement);
    }
  }

  /** Holt `{base}/{kind}/{format}/?{query}`; 204 → null; JSON abgelehnt → XML versuchen und merken. */
  private async getDocument(
    service: OerebService,
    kind: "getegrid" | "extract",
    query: string,
    what: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    const load = (format: OerebFormat) =>
      oerebRequest(`${service.baseUrl}/${kind}/${format}/?${query}`, {
        what,
        canton: this.canton,
        signal,
        authHeader: service.authHeader,
        accept: format === "xml" ? "application/xml" : "application/json",
      });

    let result = await load(service.format);
    if (result.kind === "format_rejected" && service.format === "json") {
      await rememberOerebFormat(this.canton, "xml");
      result = await load("xml");
    }
    if (result.kind === "format_rejected") {
      throw new OerebParseError(`${what} lehnt das Format ab (HTTP ${result.status})`);
    }
    return result.kind === "empty" ? null : parseBody(result.text, what);
  }

  /**
   * Kantonale Adapter können hier IDENTDN-Kandidaten (Grundbuchkreis-Kennung) aus der
   * BFS-Nummer ableiten. Standard: keine — dann greift resolveParcel über geo.admin.ch.
   */
  protected identDnCandidates(_input: GetEgridInput): string[] {
    return [];
  }

  private async fromEgridService(input: GetEgridInput): Promise<EgridCandidate[]> {
    const { en, signal } = input;
    if (en) {
      return this.withService({ signal }, async (service) =>
        parseEgridResponse(
          await this.getDocument(service, "getegrid", `EN=${en[0]},${en[1]}`, "ÖREB-GetEGRID (EN)", signal)
        )
      );
    }
    const identDns = this.identDnCandidates(input);
    if (!identDns.length) return [];
    const wanted = normalizeParcel(input.parcelNumber);
    return this.withService({ signal }, async (service) => {
      const found: EgridCandidate[] = [];
      for (const identDn of identDns) {
        const query = `IDENTDN=${encodeURIComponent(identDn)}&NUMBER=${encodeURIComponent(input.parcelNumber.trim())}`;
        found.push(...parseEgridResponse(await this.getDocument(service, "getegrid", query, "ÖREB-GetEGRID (IDENTDN)", signal)));
      }
      return found.filter((c) => !c.number || normalizeParcel(c.number) === wanted);
    });
  }

  /** EGRIDs zu einem Grundstück samt Details. Bei mehreren Treffern entscheidet der Nutzer. */
  async resolveEgrid(input: GetEgridInput): Promise<EgridResolution> {
    const fromService = await this.fromEgridService(input);
    if (fromService.length) {
      // Bei Baurechten/Bergwerken auf derselben Parzelle zählt die Liegenschaft selbst.
      const realEstates = fromService.filter((c) => c.typeCode === "RealEstate");
      const chosen = realEstates.length ? realEstates : fromService;
      const egrids = Array.from(new Set(chosen.map((c) => c.egrid)));
      return {
        egrids,
        candidates: egrids.map((egrid) => ({
          egrid,
          number: chosen.find((c) => c.egrid === egrid)?.number ?? null,
          municipality: input.municipality || null,
          bfs: input.bfsNumber ?? null,
          canton: this.canton,
          e: input.en?.[0] ?? null,
          n: input.en?.[1] ?? null,
          type: null,
          oereb_pdf_url: oerebPdfUrl(this.canton, egrid),
        })),
      };
    }
    if (input.en) return { egrids: [], candidates: [] };

    const parcel = await resolveParcel({
      canton: this.canton,
      municipality: input.municipality,
      number: input.parcelNumber,
      bfs: input.bfsNumber,
      signal: input.signal,
    });
    if (parcel.status === "unavailable") {
      throw new OerebUnreachableError(`Parzellensuche geo.admin.ch nicht verfügbar: ${parcel.message}`);
    }
    return { egrids: parcel.candidates.map((c) => c.egrid), candidates: parcel.candidates };
  }

  async getEgrid(input: GetEgridInput): Promise<string[]> {
    return (await this.resolveEgrid(input)).egrids;
  }

  async getExtract(egrid: string, opts: { signal?: AbortSignal } = {}): Promise<OerebExtract> {
    const id = egrid.trim().toUpperCase();
    if (!/^CH\d{12}$/.test(id)) throw new OerebNoEgridError(`Ungültige EGRID: ${egrid}`);
    const { signal } = opts;
    return this.withService({ egrid: id, signal }, async (service) => {
      const query = `EGRID=${id}&LANG=${encodeURIComponent(service.language)}&GEOMETRY=false`;
      const doc = await this.getDocument(service, "extract", query, "ÖREB-Auszug", signal);
      if (doc === null) throw new OerebNoEgridError(`Kein ÖREB-Auszug für EGRID ${id} vorhanden`);
      const normalized = normalizeExtract(doc, { otherLegend: OTHER_LEGEND_CANTONS.has(this.canton) });
      const extract = parseExtractResponse(normalized, this.canton, service.language);
      if (extract.egrid.toUpperCase() !== id) {
        throw new OerebParseError(`ÖREB-Auszug gehört zu EGRID ${extract.egrid}, angefragt war ${id}`);
      }
      return extract;
    });
  }

  /**
   * Nutzungsplanungs-Eintrag mit dem grössten Flächenanteil. Ohne kantonale Codeliste
   * kann der generische Adapter nur den Legendentext als Grobklasse liefern.
   */
  extractZone(extract: OerebExtract): ZoneResult {
    const best = pickZoneRestriction(extract);
    const source = `oereb:${this.canton}`;
    if (!best) return { zone: null, confidence: "none", source };
    const label = best.legendText ?? best.typeCode;
    return { zone: label, confidence: label ? "coarse" : "none", source };
  }
}

/**
 * Der massgebliche Nutzungsplanungs-Eintrag eines Auszugs: concern 'affects', keine
 * überlagernden Hinweise ("Hinweis Wald", Naturgefahren, …), grösster Flächenanteil.
 * `isOverlay` erlaubt kantonale Verfeinerung über den Zonencode.
 */
export function pickZoneRestriction(
  extract: OerebExtract,
  isOverlay: (t: OerebTheme) => boolean = () => false
): OerebTheme | null {
  const candidates = extract.themes.filter(
    (t) =>
      t.themeCode === OEREB_THEME_NUTZUNGSPLANUNG &&
      t.concern === "affects" &&
      (t.legendText || t.typeCode) &&
      !/^hinweis\b/i.test(t.legendText ?? "") &&
      !isOverlay(t)
  );
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) => (b.areaPct ?? -1) - (a.areaPct ?? -1) || (b.areaM2 ?? -1) - (a.areaM2 ?? -1)
  );
  return candidates[0];
}
