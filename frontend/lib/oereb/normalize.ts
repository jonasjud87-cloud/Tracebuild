/**
 * Bringt die Auszugs-Varianten der Kantone in die Form, die parseExtractResponse erwartet.
 * Rein, ohne Netz. Läuft vor dem Parser, weil Map (Regel 6) dort wegfällt.
 *
 *  1. Hüllen: GetExtractByIdResponse, Item, Extract, extract, ?xml
 *  2. {LocalisedText: …} als einziger Inhalt → [{Language, Text}] (UR, OW, NW, SO, SH)
 *  3. Zahlen-Enums der .NET-Dienste (FR, GE, VD): Language, Lawstatus.Code, Canton,
 *     LegalProvisions[].Type.Code
 *  4. LU-Alias: LocalisedText an Restriction, Dokument und ResponsibleOffice
 *  5. URLs ohne Schema: https:// voranstellen (LU, FR)
 *  6. Echte Legende aus Map.OtherLegend (nur otherLegend: true, siehe service-quirks)
 */

type Dict = Record<string, unknown>;

const LANGUAGE_ENUM = ["de", "fr", "it", "rm", "en"];
const LAWSTATUS_ENUM = ["inForce", "changeWithPreEffect", "changeWithoutPreEffect"];
const DOCUMENT_TYPE_ENUM = ["LegalProvision", "Law", "Hint"];
const CANTON_ENUM = [
  "ZH", "BE", "LU", "UR", "SZ", "OW", "NW", "GL", "ZG", "FR", "SO", "BS", "BL",
  "SH", "AR", "AI", "SG", "GR", "AG", "TG", "TI", "VD", "VS", "NE", "GE", "JU",
];

function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function keyOf(obj: Dict, name: string): string | undefined {
  if (name in obj) return name;
  const wanted = name.toLowerCase();
  return Object.keys(obj).find((k) => k.toLowerCase() === wanted);
}

function read(obj: unknown, name: string): unknown {
  if (!isDict(obj)) return undefined;
  const key = keyOf(obj, name);
  return key === undefined ? undefined : obj[key];
}

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v === undefined || v === null ? [] : [v];
}

function fromEnum(table: string[], value: number): string {
  return table[value] ?? String(value);
}

function walk(value: unknown, parentKey: string): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, parentKey));
  if (!isDict(value)) return value;

  const out: Dict = {};
  for (const [key, child] of Object.entries(value)) {
    if (isDict(child) && Object.keys(child).length === 1 && keyOf(child, "LocalisedText")) {
      out[key] = asList(walk(read(child, "LocalisedText"), key));
    } else {
      out[key] = walk(child, key);
    }
  }

  const language = keyOf(out, "Language");
  if (language && typeof out[language] === "number") out[language] = fromEnum(LANGUAGE_ENUM, out[language] as number);

  const code = keyOf(out, "Code");
  if (code && typeof out[code] === "number" && parentKey.toLowerCase() === "lawstatus") {
    out[code] = fromEnum(LAWSTATUS_ENUM, out[code] as number);
  }

  if (parentKey.toLowerCase() === "legalprovisions") {
    const type = read(out, "Type");
    const typeCode = isDict(type) ? keyOf(type, "Code") : undefined;
    if (isDict(type) && typeCode && typeof type[typeCode] === "number") {
      type[typeCode] = fromEnum(DOCUMENT_TYPE_ENUM, type[typeCode] as number);
    }
  }
  return out;
}

/** "www.fr.ch" → "https://www.fr.ch". Nur, was klar wie ein Host aussieht. */
function withScheme(url: string): string {
  const u = url.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(u) ? `https://${u}` : u;
}

function fixUrls(owner: Dict, field: string): void {
  const key = keyOf(owner, field);
  if (key === undefined) return;
  const value = owner[key];
  if (typeof value === "string") {
    owner[key] = withScheme(value);
    return;
  }
  for (const entry of asList(value)) {
    if (!isDict(entry)) continue;
    const text = keyOf(entry, "Text");
    if (text && typeof entry[text] === "string") entry[text] = withScheme(entry[text] as string);
  }
}

/** LU führt LocalisedText statt des fachlichen Schlüssels. */
function applyAlias(owner: Dict, field: string): void {
  const alias = keyOf(owner, "LocalisedText");
  if (alias && !keyOf(owner, field)) owner[field] = owner[alias];
}

function normalizeOffice(office: unknown): void {
  if (!isDict(office)) return;
  applyAlias(office, "OfficeAtWeb");
  fixUrls(office, "OfficeAtWeb");
}

function applyOtherLegend(restriction: Dict): void {
  const typeCode = read(restriction, "TypeCode");
  if (typeCode === undefined || typeCode === null || typeCode === "") return;
  const match = asList(read(read(restriction, "Map"), "OtherLegend")).find(
    (e) => String(read(e, "TypeCode") ?? "") === String(typeCode)
  );
  const legend = read(match, "LegendText");
  if (legend === undefined || legend === null) return;
  const key = keyOf(restriction, "LegendText") ?? "LegendText";
  if (!keyOf(restriction, "SubTheme")) restriction.SubTheme = restriction[key];
  restriction[key] = legend;
}

function normalizeRestriction(restriction: unknown, otherLegend: boolean): void {
  if (!isDict(restriction)) return;
  applyAlias(restriction, "LegendText");
  if (otherLegend) applyOtherLegend(restriction);
  normalizeOffice(read(restriction, "ResponsibleOffice"));
  for (const doc of asList(read(restriction, "LegalProvisions"))) {
    if (!isDict(doc)) continue;
    applyAlias(doc, "TextAtWeb");
    fixUrls(doc, "TextAtWeb");
    normalizeOffice(read(doc, "ResponsibleOffice"));
  }
}

function unwrap(doc: unknown): unknown {
  const response = read(doc, "GetExtractByIdResponse") ?? doc;
  const item = read(response, "Item");
  const first = Array.isArray(item) ? item[0] : item;
  if (read(first, "RealEstate") !== undefined) return first;
  return read(response, "Extract") ?? response;
}

/** Nicht als Auszug erkennbare Dokumente bleiben unverändert: Den Fehler meldet der Parser. */
export function normalizeExtract(doc: unknown, opts: { otherLegend?: boolean } = {}): unknown {
  const extract = walk(unwrap(doc), "");
  if (!isDict(extract)) return extract;

  const realEstate = read(extract, "RealEstate");
  if (isDict(realEstate)) {
    const canton = keyOf(realEstate, "Canton");
    if (canton && typeof realEstate[canton] === "number") {
      realEstate[canton] = fromEnum(CANTON_ENUM, realEstate[canton] as number);
    }
    for (const r of asList(read(realEstate, "RestrictionOnLandownership"))) {
      normalizeRestriction(r, opts.otherLegend === true);
    }
  }
  return extract;
}
