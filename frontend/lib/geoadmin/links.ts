import { oerebPdfUrl } from "../oereb/service-quirks";
import type { GeodataResponse } from "./contract";

/**
 * Links einer Parzelle. Rein. Der PDF-Link kommt aus der bekannten Basis (oerebPdfUrl), weil
 * `oereb_extract_pdf` bei ZG auf /ors zeigt und NE LANG=fr braucht.
 * Geoportal in der aktuellen Hash-Form: Die Legacy-Form (?E=&N=) wird umgeleitet und verliert den Punkt.
 */
export function buildLinks(input: {
  canton: string | null | undefined;
  egrid: string | null | undefined;
  e: number | null;
  n: number | null;
  /** Felder aus dem Layer stand-oerebkataster, falls abgerufen. */
  urlOereb?: string | null;
  extractPdf?: string | null;
}): GeodataResponse["links"] {
  const hasPosition = input.e !== null && input.n !== null;
  return {
    geoportal: hasPosition
      ? `https://map.geo.admin.ch/#/map?lang=de&center=${input.e},${input.n}&z=10&crosshair=marker,${input.e},${input.n}&layers=ch.swisstopo-vd.amtliche-vermessung`
      : null,
    canton_portal: input.urlOereb ?? null,
    oereb_pdf: oerebPdfUrl(input.canton, input.egrid) ?? input.extractPdf ?? null,
  };
}
