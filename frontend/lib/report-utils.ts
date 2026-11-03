/** Geteilte Helfer für clientseitige Report-Exporte (PDF via Druckdialog, CSV-Download). */

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Zellen, die mit = + - @ oder Tab beginnen, wertet Excel als Formel (CSV-Injection).
 * Die Texte kommen vom Modell oder von Nutzern — ein führendes Hochkomma macht daraus
 * Text; Excel zeigt es nicht an.
 */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r\t]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
}
