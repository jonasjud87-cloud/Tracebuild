import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { searchGeo } from "@/lib/geoadmin/search";
import type { GeoSearchResponse } from "@/lib/geoadmin/contract";

export const dynamic = "force-dynamic";

const LANGUAGES = new Set(["de", "fr", "it", "en"]);

export async function GET(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const params = new URL(request.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    const lang = params.get("lang") ?? "de";
    if (q.length < 3) {
      const empty: GeoSearchResponse = { results: [], unavailable: false };
      return ok(empty);
    }
    return ok<GeoSearchResponse>(await searchGeo(q.slice(0, 200), LANGUAGES.has(lang) ? lang : "de"));
  } catch (e) {
    console.error("Geo-Suche fehlgeschlagen:", e);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
