import { createHash } from "node:crypto";

/** sha256 des Normtexts, unabhängig von Zeilenumbrüchen und Leerzeichen der PDF-Extraktion. */
export function normTextHash(text: string): string {
  return createHash("sha256").update(text.normalize("NFC").replace(/\s+/g, " ").trim()).digest("hex");
}

/**
 * Cache-Schlüssel des Normenblatts. Norm-IDs allein genügen nicht: Importierte Normen behalten
 * beim Überschreiben ihre ID. Manuelle Normen haben keinen text_sha256 und behalten ihren
 * bisherigen Hash, ihre Caches bleiben also gültig.
 */
export function hashNormEntries(norms: { id: string; text_sha256?: string | null }[]): string {
  const entries = norms.map((n) => (n.text_sha256 ? `${n.id}:${n.text_sha256}` : n.id)).sort();
  return createHash("sha256").update(entries.join(",")).digest("hex");
}
