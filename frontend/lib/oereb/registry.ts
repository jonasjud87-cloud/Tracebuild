import type { OerebAdapter } from "./types";
import { SgOerebAdapter } from "./adapters/sg";

/**
 * Kantonskürzel → Adapter-Fabrik. Nur Kantone mit registriertem Adapter werden über
 * ÖREB abgefragt; alle anderen behalten das bisherige Verhalten (kein Auszug).
 * Fabriken statt Instanzen, damit die Env-Variable zur Laufzeit gelesen wird.
 */
const ADAPTERS: Record<string, () => OerebAdapter> = {
  SG: () => new SgOerebAdapter(),
};

function normalizeCanton(canton: string | null | undefined): string {
  return (canton ?? "").trim().toUpperCase();
}

export function isSupported(canton: string | null | undefined): boolean {
  return normalizeCanton(canton) in ADAPTERS;
}

export function getAdapter(canton: string | null | undefined): OerebAdapter | null {
  const factory = ADAPTERS[normalizeCanton(canton)];
  return factory ? factory() : null;
}

export function supportedCantons(): string[] {
  return Object.keys(ADAPTERS);
}
