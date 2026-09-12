/**
 * Generischer ÖREB-Adapter nach swisstopo-Weisung "ÖREB-Kataster: ÖREB-Webservice" (v2).
 *
 * Pro Kanton unterscheidet sich nur die Basis-URL; die Signatur ist identisch:
 *   GET {base}/getegrid/json/?EN=<E>,<N>                (LV95)
 *   GET {base}/getegrid/json/?IDENTDN=<x>&NUMBER=<n>
 *   GET {base}/extract/json/?EGRID=<CHxxxxxxxxxxxx>&LANG=de
 *
 * Das Parsing ist bewusst tolerant (Gross-/Kleinschreibung der Schlüssel, `extract`
 * vs. `Extract`, Text-Arrays `[{Language, Text}]`), Fehler dagegen sind laut:
 * jede Störung wird als typisierter OerebError geworfen, nie still weggeschluckt.
 */
import type {
  Concern,
  LegalStatus,
  OerebAdapter,
  OerebExtract,
  OerebLawLink,
  OerebTheme,
  ZoneResult,
} from "../types";
import {
  OerebAmbiguousError,
  OerebError,
  OerebNoEgridError,
  OerebParseError,
  OerebUnreachableError,
} from "../errors";

export { OerebAmbiguousError, OerebError, OerebNoEgridError, OerebParseError, OerebUnreachableError };

export const OEREB_TIMEOUT_MS = 15_000;
export const OEREB_THEME_NUTZUNGSPLANUNG = "ch.Nutzungsplanung";

const GEO_ADMIN_SEARCH = "https://api3.geo.admin.ch/rest/services/api/SearchServer";

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

function parseThemeRef(v: unknown): ThemeRef | null {
  const code = asString(getKey(v, "Code"));
  if (!code) return null;
  const name = localizedText(getKey(v, "Text")) ?? code;
  const subTheme = asString(getKey(v, "SubCode", "Subcode")) ?? null;
  return { code, name, subTheme };
}

function parseLawLinks(v: unknown): OerebLawLink[] {
  const links: OerebLawLink[] = [];
  for (const lp of asArray(v)) {
    const title = localizedText(getKey(lp, "Title"));
    const url = localizedText(getKey(lp, "TextAtWeb"));
    if (!title && !url) continue;
    links.push({ title: title ?? url ?? "", url });
  }
  return links;
}

function parseAuthority(v: unknown): OerebTheme["authority"] {
  if (!isDict(v)) return null;
  const name = localizedText(getKey(v, "Name"));
  const url = localizedText(getKey(v, "OfficeAtWeb"));
  if (!name && !url) return null;
  return { name, url };
}

function parseRestriction(r: unknown): OerebTheme | null {
  const theme = parseThemeRef(getKey(r, "Theme"));
  if (!theme) return null;
  const subTheme = theme.subTheme ?? localizedText(getKey(r, "SubTheme"));
  return {
    themeCode: theme.code,
    themeName: theme.name,
    subTheme,
    concern: "affects",
    legalStatus: mapLawStatus(getKey(getKey(r, "Lawstatus", "LawStatus"), "Code")),
    areaPct: asNumber(getKey(r, "PartInPercent")),
    areaM2: asNumber(getKey(r, "AreaShare")),
    typeCode: asString(getKey(r, "TypeCode")),
    legendText: localizedText(getKey(r, "LegendText")),
    lawLinks: parseLawLinks(getKey(r, "LegalProvisions")),
    authority: parseAuthority(getKey(r, "ResponsibleOffice")),
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
export function parseExtractResponse(json: unknown, canton: string): OerebExtract {
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
    const t = parseRestriction(r);
    if (!t) continue;
    themes.push(t);
    affectedCodes.add(t.themeCode);
  }

  for (const c of asArray(getKey(extract, "ConcernedTheme"))) {
    const ref = parseThemeRef(c);
    if (!ref || affectedCodes.has(ref.code)) continue;
    affectedCodes.add(ref.code);
    themes.push(themeStub(ref, "affects", c));
  }

  const seen = new Set<string>();
  const pushStubs = (list: unknown, concern: Concern) => {
    for (const c of asArray(list)) {
      const ref = parseThemeRef(c);
      if (!ref) continue;
      const key = `${concern}|${ref.code}|${ref.subTheme ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      themes.push(themeStub(ref, concern, c));
    }
  };
  pushStubs(getKey(extract, "NotConcernedTheme"), "not_affects");
  pushStubs(getKey(extract, "ThemeWithoutData"), "no_data");

  const municipality =
    localizedText(getKey(realEstate, "MunicipalityName", "Municipality")) ??
    asString(getKey(realEstate, "MunicipalityCode"));

  return {
    canton: asString(getKey(realEstate, "Canton")) ?? canton,
    egrid,
    identDn: asString(getKey(realEstate, "IdentDN", "IdentDn")),
    parcelNumber: asString(getKey(realEstate, "Number")),
    municipality,
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

export function parseEgridResponse(json: unknown): EgridCandidate[] {
  if (json === null || json === undefined) return [];
  const list = asArray(getKey(json, "GetEGRIDResponse") ?? json);
  const out: EgridCandidate[] = [];
  for (const item of list) {
    const egrid = asString(getKey(item, "egrid", "EGRID"));
    if (!egrid) continue;
    const type = getKey(item, "type", "Type");
    out.push({
      egrid: egrid.toUpperCase(),
      number: asString(getKey(item, "number", "Number")),
      identDn: asString(getKey(item, "identDN", "IdentDN")),
      typeCode: asString(getKey(type, "Code")) ?? asString(type),
    });
  }
  return out;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeParcel(s: string): string {
  return s.trim().toUpperCase().replace(/^0+(?=\d)/, "");
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function fetchJson(url: string, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(OEREB_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "TimeoutError" ? `Timeout nach ${OEREB_TIMEOUT_MS / 1000} s` : String(e);
    throw new OerebUnreachableError(`${what} nicht erreichbar: ${reason}`, e);
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = (await res.text().catch(() => ""))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    throw new OerebUnreachableError(`${what} antwortet mit HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new OerebParseError(`${what} liefert kein gültiges JSON`, e);
  }
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export interface GetEgridInput {
  municipality: string;
  parcelNumber: string;
  bfsNumber?: number;
  en?: [number, number];
}

export class GenericOerebAdapter implements OerebAdapter {
  readonly canton: string;
  private readonly baseUrl: string | null | undefined;

  constructor(canton: string, baseUrl: string | null | undefined) {
    this.canton = canton;
    this.baseUrl = baseUrl;
  }

  /** Basis-URL ohne abschliessenden Slash; fehlt die Konfiguration → 'unreachable'. */
  protected get base(): string {
    const url = this.baseUrl?.trim();
    if (!url) throw new OerebUnreachableError(`ÖREB-Basis-URL für ${this.canton} nicht konfiguriert`);
    return url.replace(/\/+$/, "");
  }

  /**
   * Kantonale Adapter können hier IDENTDN-Kandidaten (Grundbuchkreis-Kennung) aus
   * Gemeinde/BFS-Nummer ableiten. Standard: keine — dann greift die Parzellensuche
   * über geo.admin.ch.
   */
  protected identDnCandidates(_input: GetEgridInput): string[] {
    return [];
  }

  async getEgrid(input: GetEgridInput): Promise<string[]> {
    const base = this.base;
    let candidates: EgridCandidate[] = [];

    if (input.en) {
      const [e, n] = input.en;
      const json = await fetchJson(`${base}/getegrid/json/?EN=${e},${n}`, "ÖREB-GetEGRID (EN)");
      candidates = parseEgridResponse(json);
    } else {
      const wanted = normalizeParcel(input.parcelNumber);
      for (const identDn of this.identDnCandidates(input)) {
        const url =
          `${base}/getegrid/json/?IDENTDN=${encodeURIComponent(identDn)}` +
          `&NUMBER=${encodeURIComponent(input.parcelNumber.trim())}`;
        const json = await fetchJson(url, "ÖREB-GetEGRID (IDENTDN)");
        candidates.push(...parseEgridResponse(json));
      }
      candidates = candidates.filter((c) => !c.number || normalizeParcel(c.number) === wanted);
      if (!candidates.length) {
        candidates = await this.resolveViaGeoAdmin(input);
      }
    }

    // Bei Baurechten/Bergwerken auf derselben Parzelle zählt die Liegenschaft selbst.
    const realEstates = candidates.filter((c) => c.typeCode === "RealEstate");
    const chosen = realEstates.length ? realEstates : candidates;
    return Array.from(new Set(chosen.map((c) => c.egrid)));
  }

  /**
   * Nationale Parzellensuche der swisstopo (api3.geo.admin.ch). Das Trefferdetail lautet
   * "<Nummer> <gemeinde> <BFS> <egrid>"; nur exakte Treffer auf Nummer und Gemeinde zählen.
   */
  protected async resolveViaGeoAdmin(input: GetEgridInput): Promise<EgridCandidate[]> {
    const url = new URL(GEO_ADMIN_SEARCH);
    url.searchParams.set("searchText", `${input.municipality.trim()} ${input.parcelNumber.trim()}`);
    url.searchParams.set("origins", "parcel");
    url.searchParams.set("type", "locations");
    url.searchParams.set("limit", "20");
    url.searchParams.set("sr", "2056");
    const json = await fetchJson(url.toString(), "Parzellensuche geo.admin.ch");

    const wantedNumber = normalizeParcel(input.parcelNumber);
    const wantedName = normalizeName(input.municipality);
    const out: EgridCandidate[] = [];
    for (const r of asArray(getKey(json, "results"))) {
      const detail = asString(getKey(getKey(r, "attrs"), "detail"));
      if (!detail) continue;
      const tokens = detail.split(/\s+/);
      if (tokens.length < 4) continue;
      const egrid = tokens[tokens.length - 1];
      const bfs = Number(tokens[tokens.length - 2]);
      const name = tokens.slice(1, -2).join(" ");
      if (!/^ch\d{12}$/i.test(egrid)) continue;
      if (normalizeParcel(tokens[0]) !== wantedNumber) continue;
      const nameMatches = normalizeName(name) === wantedName;
      const bfsMatches = input.bfsNumber !== undefined && bfs === input.bfsNumber;
      if (!nameMatches && !bfsMatches) continue;
      out.push({ egrid: egrid.toUpperCase(), number: tokens[0], identDn: null, typeCode: "RealEstate" });
    }
    return out;
  }

  async getExtract(egrid: string): Promise<OerebExtract> {
    const id = egrid.trim().toUpperCase();
    if (!/^CH\d{12}$/.test(id)) throw new OerebNoEgridError(`Ungültige EGRID: ${egrid}`);
    const url = `${this.base}/extract/json/?EGRID=${id}&GEOMETRY=false&LANG=de`;
    const json = await fetchJson(url, "ÖREB-Auszug");
    if (json === null) throw new OerebNoEgridError(`Kein ÖREB-Auszug für EGRID ${id} vorhanden`);
    const extract = parseExtractResponse(json, this.canton);
    if (extract.egrid.toUpperCase() !== id) {
      throw new OerebParseError(`ÖREB-Auszug gehört zu EGRID ${extract.egrid}, angefragt war ${id}`);
    }
    return extract;
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
