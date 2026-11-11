import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { lookupParcel } from "@/lib/geoadmin/parcel";
import { lookupFlParcel } from "@/lib/oereb/fl-parcel";
import { isValidEgrid, isValidLv95 } from "@/lib/geoadmin/validate";
import type { GeoParcelResponse } from "@/lib/geoadmin/contract";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const params = new URL(request.url).searchParams;
    const egrid = params.get("egrid")?.trim().toUpperCase();
    const e = Number(params.get("e"));
    const n = Number(params.get("n"));
    const hasPosition = isValidLv95(e, n);
    if (egrid) {
      if (!isValidEgrid(egrid)) return err("Ungültige EGRID");
      return ok<GeoParcelResponse>(await lookupParcel(hasPosition ? { egrid, e, n } : { egrid }, { fallback: lookupFlParcel }));
    }
    if (!hasPosition) return err("egrid oder gültige LV95-Koordinaten e und n erforderlich");
    // FL: geo.admin.ch kennt dort keine EGRID, der ÖREB-Dienst FL liefert sie (Injektion gegen Zyklus).
    return ok<GeoParcelResponse>(await lookupParcel({ e, n }, { fallback: lookupFlParcel }));
  } catch (e) {
    console.error("Geo-Parzellenabfrage fehlgeschlagen:", e);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
