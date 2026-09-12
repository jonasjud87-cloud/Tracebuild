/**
 * Reine Mapping-Logik: ÖREB-Themen (concern = 'affects') → Normen über
 * oereb_theme_mappings (case-insensitive Teilstring gegen den Freitext norms.category).
 * Keine DB-Zugriffe — dadurch im Trockenlauf und in Tests ohne Supabase nutzbar.
 */

/**
 * Bundes-Pflichtthemen des ÖREB-Katasters (Codes v2). Nur diese werden auf Normen
 * gemappt (Entscheidung 2); kantonale Themen (z.B. "ch.SG.…") laufen nur mit, wenn
 * eine Org ein eigenes Mapping dafür angelegt hat.
 */
export const FEDERAL_THEME_CODES: ReadonlySet<string> = new Set([
  "ch.Nutzungsplanung",
  "ch.ProjektierungszonenNationalstrassen",
  "ch.BaulinienNationalstrassen",
  "ch.ProjektierungszonenEisenbahnanlagen",
  "ch.BaulinienEisenbahnanlagen",
  "ch.ProjektierungszonenFlughafenanlagen",
  "ch.BaulinienFlughafenanlagen",
  "ch.Sicherheitszonenplan",
  "ch.BelasteteStandorte",
  "ch.BelasteteStandorteMilitaer",
  "ch.BelasteteStandorteZivileFlugplaetze",
  "ch.BelasteteStandorteOeffentlicherVerkehr",
  "ch.Grundwasserschutzzonen",
  "ch.Grundwasserschutzareale",
  "ch.Laermempfindlichkeitsstufen",
  "ch.StatischeWaldgrenzen",
  "ch.Waldabstandslinien",
  "ch.Waldreservate",
]);

export function isFederalTheme(themeCode: string): boolean {
  return FEDERAL_THEME_CODES.has(themeCode);
}

export interface MappingThemeInput {
  theme_code: string;
  theme_name: string;
}
export interface MappingRuleInput {
  theme_code: string;
  category_pattern: string;
}
export interface MappingNormInput {
  id: string;
  category: string | null;
}

export interface OerebGap {
  themeCode: string;
  themeName: string;
}

export interface OerebMatchResult {
  /** norm_id → betroffene Themencodes (in Themenreihenfolge, ohne Duplikate) */
  byNorm: Map<string, string[]>;
  /** Themencode → gefundene norm_ids */
  byTheme: Map<string, string[]>;
  /**
   * Betroffene Themen ohne passende Norm. Berücksichtigt werden Bundes-Pflichtthemen
   * sowie Themen, für die ein aktives Mapping existiert — nur dort ist eine fehlende
   * Norm eine Lücke und kein Rauschen (SG liefert >100 kantonale Themenzeilen).
   */
  gaps: OerebGap[];
}

/** Trigger-Wert in project_norms für eine ÖREB-Zuweisung. */
export function oerebTrigger(themeCode: string): string {
  return `oereb:${themeCode}`;
}

function matchesPattern(category: string | null, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  return (category ?? "").toLowerCase().includes(p);
}

/**
 * Ordnet betroffenen ÖREB-Themen die Normen zu, deren `category` eines der
 * Mapping-Muster des Themas enthält. Themen werden über ihren Code dedupliziert
 * (Sub-Themen/mehrere Restriktionen desselben Themas zählen einmal).
 */
export function matchOerebNorms(
  affectedThemes: MappingThemeInput[],
  mappings: MappingRuleInput[],
  norms: MappingNormInput[]
): OerebMatchResult {
  // Themen deduplizieren, Reihenfolge des ersten Auftretens behalten.
  const themes: MappingThemeInput[] = [];
  const seen = new Set<string>();
  for (const t of affectedThemes) {
    if (!t.theme_code || seen.has(t.theme_code)) continue;
    seen.add(t.theme_code);
    themes.push({ theme_code: t.theme_code, theme_name: t.theme_name || t.theme_code });
  }

  const patternsByTheme = new Map<string, string[]>();
  for (const m of mappings) {
    const list = patternsByTheme.get(m.theme_code) ?? [];
    if (!list.includes(m.category_pattern)) list.push(m.category_pattern);
    patternsByTheme.set(m.theme_code, list);
  }

  const byNorm = new Map<string, string[]>();
  const byTheme = new Map<string, string[]>();
  const gaps: OerebGap[] = [];

  for (const theme of themes) {
    const patterns = patternsByTheme.get(theme.theme_code) ?? [];
    const hits = patterns.length
      ? norms.filter((n) => patterns.some((p) => matchesPattern(n.category, p))).map((n) => n.id)
      : [];

    if (hits.length) {
      byTheme.set(theme.theme_code, hits);
      for (const id of hits) {
        const codes = byNorm.get(id) ?? [];
        if (!codes.includes(theme.theme_code)) codes.push(theme.theme_code);
        byNorm.set(id, codes);
      }
    } else if (isFederalTheme(theme.theme_code) || patterns.length) {
      gaps.push({ themeCode: theme.theme_code, themeName: theme.theme_name });
    }
  }

  return { byNorm, byTheme, gaps };
}
