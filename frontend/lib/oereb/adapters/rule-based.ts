/**
 * ÖREB-Adapter für alle Kantone ohne eigene Klasse: Der Abruf ist überall gleich, die
 * Bauzone folgt den Regeln in zone-rules.ts.
 */
import type { OerebExtract, ZoneResult } from "../types";
import { applyZoneRule, zoneRuleFor } from "../zone-rules";
import { GenericOerebAdapter } from "./generic";

export class RuleBasedOerebAdapter extends GenericOerebAdapter {
  extractZone(extract: OerebExtract): ZoneResult {
    return applyZoneRule(extract, zoneRuleFor(this.canton), `oereb:${this.canton}`);
  }
}
