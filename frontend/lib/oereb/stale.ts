import { normalizeParcel } from "../geoadmin/parcel";

export interface StoredExtractRef {
  egrid?: string | null;
  canton?: string | null;
  parcel_number?: string | null;
}
export interface ProjectParcelRef {
  egrid?: string | null;
  parcel_number?: string | null;
  location?: { canton?: string } | null;
}

function parcelOf(value: string | null | undefined): string {
  return normalizeParcel(value ?? "");
}

/**
 * Gehört der gespeicherte Auszug zu einem anderen Grundstück als das Projekt? Sind beide
 * EGRID bekannt, entscheidet nur sie: Die Nummer im Auszug kann anders geschrieben sein
 * (BS «0121»), und ein Projekt mit EGRID braucht gar keine Nummer.
 */
export function isExtractStale(extract: StoredExtractRef | null, project: ProjectParcelRef): boolean {
  if (!extract) return false;
  if (extract.egrid && project.egrid) return extract.egrid.toUpperCase() !== project.egrid.toUpperCase();
  const canton = (project.location?.canton ?? "").toUpperCase();
  if ((extract.canton ?? "").toUpperCase() !== canton) return true;
  return parcelOf(extract.parcel_number) !== parcelOf(project.parcel_number);
}
