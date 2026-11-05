import { OEREB_SUPPORTED_CANTONS } from "./cantons";
import type { OerebAdapter } from "./types";
import { ArOerebAdapter } from "./adapters/ar";
import { RuleBasedOerebAdapter } from "./adapters/rule-based";
import { SgOerebAdapter } from "./adapters/sg";

/**
 * Kantonskürzel → Adapter. SG und AR haben eigene Klassen, alle übrigen Kantone laufen über
 * den regelbasierten Adapter. Die Basis-URL löst lib/oereb/service.ts zur Laufzeit auf.
 */
function normalizeCanton(canton: string | null | undefined): string {
  return (canton ?? "").trim().toUpperCase();
}

export function isSupported(canton: string | null | undefined): boolean {
  return OEREB_SUPPORTED_CANTONS.includes(normalizeCanton(canton));
}

export function getAdapter(canton: string | null | undefined): OerebAdapter | null {
  const code = normalizeCanton(canton);
  if (!OEREB_SUPPORTED_CANTONS.includes(code)) return null;
  if (code === "AR") return new ArOerebAdapter();
  if (code === "SG") return new SgOerebAdapter();
  return new RuleBasedOerebAdapter(code);
}

export function supportedCantons(): string[] {
  return [...OEREB_SUPPORTED_CANTONS];
}
