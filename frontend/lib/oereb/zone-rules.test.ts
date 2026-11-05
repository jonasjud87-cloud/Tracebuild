/** Logik der Zonenermittlung: Gruppierung, Konfidenz und Ausschlüsse. */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { OerebExtract, OerebTheme } from "./types";
import { applyZoneRule, zoneRuleFor } from "./zone-rules";

function extractWith(entries: Partial<OerebTheme>[]): OerebExtract {
  return {
    canton: "SZ", egrid: "CH000000000000", identDn: null, parcelNumber: null, municipality: null, raw: null,
    themes: entries.map((e) => ({
      themeCode: "ch.Nutzungsplanung", themeName: "Nutzungsplanung", subTheme: null, concern: "affects",
      legalStatus: "inForce", areaPct: null, areaM2: null, typeCode: null, legendText: null,
      lawLinks: [], authority: null, raw: null, ...e,
    })),
  };
}

const zone = (canton: string, entries: Partial<OerebTheme>[]) => {
  const { zone: z, confidence } = applyZoneRule(extractWith(entries), zoneRuleFor(canton), "t");
  return [z, confidence];
};

test("Flächen derselben Legende werden summiert (UR: Kernzone in drei Zeilen)", () => {
  assert.deepEqual(
    zone("GL", [
      { legendText: "Kernzone 1", areaPct: 5 },
      { legendText: "Kernzone 1", areaPct: 19 },
      { legendText: "Kernzone 1", areaPct: 13 },
      { legendText: "Wohnzone", areaPct: 30 },
    ]),
    ["Kernzone 1", "coarse"]
  );
});

test("Sekundär zählt nur, wenn sonst nichts bleibt, und dann als low", () => {
  assert.deepEqual(
    zone("GL", [{ legendText: "Verkehrsfläche innerhalb Bauzonen", areaPct: 73 }, { legendText: "Kernzone 1", areaPct: 27 }]),
    ["Kernzone 1", "coarse"]
  );
  assert.deepEqual(zone("GL", [{ legendText: "Verkehrsfläche innerhalb Bauzonen", areaPct: 73 }]), ["Verkehrsfläche innerhalb Bauzonen", "low"]);
  assert.deepEqual(zone("GL", [{ legendText: "Wald WA", areaPct: 100 }]), ["Wald WA", "low"]);
});

test("Ohne Zonenbegriff: low mit Kandidat; nur Ausgeschlossenes: none", () => {
  assert.deepEqual(zone("GL", [{ legendText: "Dadi in porfido", areaPct: 35 }]), ["Dadi in porfido", "low"]);
  assert.deepEqual(zone("TI", [{ legendText: "Comparto soggetto a Piano Particolareggiato", areaPct: 100 }]), [null, "none"]);
  assert.deepEqual(zone("GL", [{ legendText: "Hinweis Wald" }, { legendText: "Gefahrenzone 2" }]), [null, "none"]);
});

test("Zwei Legenden je ab 40 % ohne Kantonsregel: low; mit Kantonsregel entscheidet der Anteil", () => {
  const split = [{ legendText: "Wohnzone W2", areaPct: 55, typeCode: "1101" }, { legendText: "Kernzone K", areaPct: 45, typeCode: "1401" }];
  assert.deepEqual(zone("GL", split), ["W2", "low"]);
  assert.deepEqual(zone("ZG", split), ["W2", "exact"]);
  assert.deepEqual(zone("GL", [{ legendText: "Wohnzone W2", areaPct: 80 }, { legendText: "Kernzone K", areaPct: 20 }]), ["W2", "exact"]);
});

test("Ohne Flächenangabe zählt −1, angegebene Fläche gewinnt", () => {
  assert.deepEqual(zone("GL", [{ legendText: "Wohnzone" }, { legendText: "Kernzone", areaPct: 1 }]), ["Kernzone", "coarse"]);
});

test("Planänderung bestimmt die Zone nur ohne rechtskräftigen Eintrag", () => {
  assert.deepEqual(
    zone("GL", [
      { legendText: "Kernzone", areaPct: 10 },
      { legendText: "Wohnzone", areaPct: 90, legalStatus: "changeWithPreEffect" },
    ]),
    ["Kernzone", "coarse"]
  );
  assert.deepEqual(zone("GL", [{ legendText: "Wohnzone", areaPct: 90, legalStatus: "changeWithPreEffect" }]), ["Wohnzone", "coarse"]);
});

test("Nur betroffene Themen des Standardcodes zählen", () => {
  assert.deepEqual(zone("GL", [{ legendText: "Wohnzone", concern: "not_affects" }]), [null, "none"]);
  assert.deepEqual(zone("GL", [{ legendText: "Innenstadtzone", themeCode: "ch.GL.NutzungsplanungUeberlagerungen" }]), [null, "none"]);
});

test("AG und ZG: Überlagerungen über den TypeCode weg", () => {
  assert.deepEqual(
    zone("AG", [
      { typeCode: "611101_5135", legendText: "Weitere Festlegung", areaPct: 100 },
      { typeCode: "141201", legendText: "Zone Altstadt A [ASA]", areaPct: 86.1 },
    ]),
    ["ASA", "exact"]
  );
});

test("BE: Bern und La Neuveville, Bauklassen zählen nicht, Unterstriche weg", () => {
  assert.deepEqual(
    zone("BE", [
      { subTheme: "ch.NutzungsplanungGrundnutzung", typeCode: "x", areaPct: 100, legendText: 'Plan_de_quartier_"Vieille_Ville"' },
      { subTheme: "ch.NutzungsplanungUeberlagerung", typeCode: "y", areaPct: 100, legendText: "Plan_d'alignement" },
    ]),
    ['Plan de quartier "Vieille Ville"', "coarse"]
  );
  assert.deepEqual(
    zone("BE", [{ subTheme: "ch.NutzungsplanungGrundnutzungBauklassen", areaPct: 100, legendText: "Bauklasse 3" }]),
    [null, "none"]
  );
});

test("AI: TypeCode ist das Kürzel; NE: Muster wie FR (ungeprüft)", () => {
  assert.deepEqual(
    zone("AI", [{ subTheme: "ch.NutzungsplanungKommunal", typeCode: "K", legendText: "Kernzone", areaPct: 93.7 }]),
    ["K", "exact"]
  );
  assert.deepEqual(
    zone("NE", [{ subTheme: "ch.NE.Affectationsprimaires", legendText: "Zone d'ancienne localité", areaPct: 100 }]),
    ["Zone d'ancienne localité", "coarse"]
  );
});
