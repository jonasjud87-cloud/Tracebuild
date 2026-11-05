/**
 * Live geprüfte Eigenheiten der kantonalen ÖREB-Dienste (Stand 4.11.2026). Rein, ohne
 * process.env. Der Normalfall braucht dadurch keinen Request an api3.geo.admin.ch.
 */

export const KNOWN_BASES: Readonly<Record<string, string>> = {
  AG: "https://api.geo.ag.ch/v2/oereb", AI: "https://oereb.ai.ch/ktai/wsgi/oereb",
  AR: "https://oereb.ar.ch/ktar/wsgi/oereb", BE: "https://www.oereb2.apps.be.ch",
  BL: "https://oereb.geo.bl.ch", BS: "https://api.oereb.bs.ch",
  FR: "https://maps.fr.ch/RDPPF_ws/RdppfSVC.svc", GE: "https://ge.ch/terecadastrews/RdppfSVC.svc",
  GL: "https://map.geo.gl.ch/oereb", GR: "https://oereb.geo.gr.ch/oereb",
  JU: "https://geo.jura.ch/crdppf_server", LU: "https://svc.geo.lu.ch/oereb",
  NE: "https://sitn.ne.ch/crdppf", NW: "https://www.gis-daten.ch/oereb",
  OW: "https://www.gis-daten.ch/oereb", SG: "https://oereb.geo.sg.ch/ktsg/wsgi/oereb",
  SH: "https://oereb.geo.sh.ch", SO: "https://geo.so.ch/api/oereb",
  SZ: "https://map.geo.sz.ch/oereb", TG: "https://map.geo.tg.ch/services/oereb",
  TI: "https://crdpp.geo.ti.ch/oereb2", UR: "https://prozessor-oereb.ur.ch/oereb",
  VD: "https://www.rdppf.vd.ch/ws/RdppfSVC.svc", VS: "https://rdppf.apps.vs.ch",
  ZG: "https://oereb.zg.ch/oereb", ZH: "https://maps.zh.ch/oereb/v2",
};

/** Ohne Abruf bekannte Sprachen. LANG=de ergibt dort 400, 500 oder eine WAF-Seite. */
export const PRESET_LANGUAGES: Readonly<Record<string, string>> = {
  GE: "fr", VD: "fr", JU: "fr", NE: "fr", TI: "it",
};

/** Dienste ohne JSON-Auszug (extract/json antwortet mit 406 oder 415). */
export const XML_ONLY_CANTONS: ReadonlySet<string> = new Set(["SO", "SH"]);

/** Dort steht die echte Legende nur in Map.OtherLegend (Normalisierer Regel 6). */
export const OTHER_LEGEND_CANTONS: ReadonlySet<string> = new Set(["UR", "OW", "NW"]);

/**
 * Link auf den amtlichen PDF-Auszug aus der bekannten Basis. Nicht aus `oereb_extract_pdf`,
 * weil das Feld bei ZG auf /ors zeigt und LANG fehlt (NE liefert das PDF nur mit LANG=fr).
 */
export function oerebPdfUrl(canton: string | null | undefined, egrid: string | null | undefined): string | null {
  const code = (canton ?? "").trim().toUpperCase();
  const base = KNOWN_BASES[code];
  if (!base || !egrid) return null;
  return `${base}/extract/pdf/?EGRID=${encodeURIComponent(egrid)}&LANG=${PRESET_LANGUAGES[code] ?? "de"}`;
}
