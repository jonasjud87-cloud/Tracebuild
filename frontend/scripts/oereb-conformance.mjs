// Manueller Konformitätslauf über alle Kantone: je eine Parzelle, echte Dienste. Nicht in CI
// (Fair Use). Pause 1.5 s zwischen Kantonen, OW und NW nicht direkt hintereinander (gemeinsamer
// Host, 429). Aufruf aus frontend/:
//   node --no-warnings --import ./scripts/ts-resolve-hook.mjs scripts/oereb-conformance.mjs [KT …]
// Ohne EGRID-Abkürzung prüft der Lauf auch die Parzellensuche: Gemeinde und Nummer → resolveParcel.
import { resetGeoAdminBucket } from "../lib/geoadmin/client.ts";
import { getAdapter } from "../lib/oereb/registry.ts";

// Kanton, Gemeinde, Parzelle, EGRID (Stichprobe vom 4.11.2026, öffentliche Gebäude im Hauptort).
const SAMPLES = [
  ["AG", "Aarau", "1871", "CH327790235224"],
  ["AI", "Appenzell", "152", "CH580359417719"],
  ["AR", "Herisau", "99", "CH967713352088"],
  ["BE", "Bern", "535", "CH153546763573"],
  ["BL", "Liestal", "1254", "CH127089175910"],
  ["BS", "Basel", "0121", "CH907067448984"],
  ["FR", "Fribourg", "17460", "CH468810949824"],
  ["GE", "Genève", "7304", "CH716335658801"],
  ["GL", "Glarus", "696", "CH532277695971"],
  ["GR", "Chur", "3011", "CH488486687764"],
  ["JU", "Delémont", "4642", "CH834477063375"],
  ["LU", "Luzern", "7", "CH468850358944"],
  ["NE", "Neuchâtel", "1080", "CH767849875205"],
  ["NW", "Stans", "32", "CH933477050848"],
  ["SG", "St. Gallen", "C0716", "CH507759798797"],
  ["SH", "Schaffhausen", "481", "CH445408781787"],
  ["SO", "Olten", "4513", "CH768732065261"],
  ["SZ", "Schwyz", "802", "CH427773224061"],
  ["TG", "Frauenfeld", "223", "CH107729928083"],
  ["TI", "Bellinzona", "1329", "CH990287070740"],
  ["UR", "Altdorf", "615", "CH344607776411"],
  ["VD", "Lausanne", "10071", "CH907857723624"],
  ["VS", "Sion", "24", "CH235206308395"],
  ["ZG", "Zug", "557", "CH727473066563"],
  ["ZH", "Zürich", "AA2346", "CH287399917749"],
  ["OW", "Sarnen", "4105", "CH927976043662"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.slice(2).map((c) => c.toUpperCase());
const samples = only.length ? SAMPLES.filter(([c]) => only.includes(c)) : SAMPLES;

const rows = [];
for (const [canton, municipality, number, egrid] of samples) {
  const adapter = getAdapter(canton);
  const row = { canton, suche: "-", abruf: "-", themen: "-", zone: "-", konfidenz: "-", ms: 0, detail: "" };
  const t0 = Date.now();
  resetGeoAdminBucket(); // Limit gilt je Lambda, der Lauf entspricht vielen einzelnen Abrufen.

  if (number) {
    try {
      const found = await adapter.resolveEgrid({ municipality, parcelNumber: number });
      const hit = found.egrids.length === 1 && found.egrids[0] === egrid;
      row.suche = hit ? "ok" : found.egrids.length > 1 ? `mehrdeutig (${found.egrids.length})` : found.egrids.length ? "anderes Grundstück" : "kein Treffer";
    } catch (e) {
      row.suche = `${e.status ?? "fehler"} (${String(e.message ?? e).slice(0, 60)})`;
    }
  }

  try {
    const signal = AbortSignal.timeout(60_000);
    const extract = await adapter.getExtract(egrid, { signal });
    const zone = adapter.extractZone(extract);
    row.abruf = "ok";
    row.themen = String(extract.themes.filter((t) => t.concern === "affects").length);
    row.zone = zone.zone ?? "";
    row.konfidenz = zone.confidence;
    row.detail = `${extract.municipality ?? ""} BFS ${extract.bfsNumber ?? "?"}`;
  } catch (e) {
    row.abruf = e.status ?? "fehler";
    row.detail = String(e.message ?? e).slice(0, 100);
  }
  row.ms = Date.now() - t0;
  rows.push(row);
  console.log(`${row.canton} | Suche: ${row.suche} | Abruf: ${row.abruf} | Themen: ${row.themen} | Zone: ${row.zone} | ${row.konfidenz} | ${row.ms} ms | ${row.detail}`);
  await sleep(1500);
}

const okCount = rows.filter((r) => r.abruf === "ok").length;
console.log(`\n${okCount} von ${rows.length} Kantonen mit Auszug.`);
