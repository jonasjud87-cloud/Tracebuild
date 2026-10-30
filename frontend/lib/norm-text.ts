/**
 * Upper bound for the stored text of a single norm.
 *
 * Every norm text goes in full into its own analysis call (lib/analysis-engine.ts,
 * one call per norm). 250'000 characters are roughly 70k input tokens, which leaves
 * ample room next to the system prompt and the plan PDF in the model's context.
 *
 * Longer documents are rejected instead of being cut: the old silent
 * `text.slice(0, 100_000)` dropped articles without anyone noticing (the SG PBG
 * already hit exactly 100'000 characters).
 */
export const MAX_NORM_TEXT_CHARS = 250_000;

/** Returns a user-facing error message if the text is too long, otherwise null. */
export function normTextTooLongMessage(text: string): string | null {
  if (text.length <= MAX_NORM_TEXT_CHARS) return null;
  const fmt = (n: number) => n.toLocaleString("de-CH");
  return (
    `Der Text dieser Norm ist mit ${fmt(text.length)} Zeichen zu lang (maximal ${fmt(MAX_NORM_TEXT_CHARS)}). ` +
    `Bitte das Dokument in Teile aufteilen, z. B. nach Kapiteln, und einzeln hochladen.`
  );
}
