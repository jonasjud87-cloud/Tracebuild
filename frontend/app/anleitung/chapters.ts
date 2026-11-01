// Single source for the handbook's chapter/section titles: the table of
// contents, the sticky chapter bar and the headings in page.tsx all read from
// here, so a renamed section can't drift out of the navigation.

export interface HandbookSection {
  id: string;
  title: string;
}

export interface HandbookChapter {
  id: string;
  num: number;
  title: string;
  short: string;
  desc: string;
  /** Einrichtungsthemen: stehen am Schluss und treten optisch zurück. */
  secondary?: boolean;
  sections: HandbookSection[];
}

export const CHAPTERS: HandbookChapter[] = [
  {
    id: "plaene",
    num: 1,
    title: "Pläne analysieren",
    short: "Pläne analysieren",
    desc: "Projekt anlegen, Plan hochladen, Ergebnis lesen",
    sections: [
      { id: "projekt-anlegen", title: "Projekt anlegen" },
      { id: "plan-hochladen", title: "Plan hochladen und prüfen lassen" },
      { id: "ergebnis", title: "Ergebnis lesen" },
    ],
  },
  {
    id: "normen",
    num: 2,
    title: "Normen hinterlegen",
    short: "Normen",
    desc: "Eigene Reglemente ergänzen, ÖREB-Auszug nutzen",
    secondary: true,
    sections: [
      { id: "norm-hochladen", title: "Eigene Norm in die Normen-Datenbank laden" },
      { id: "projekt-normen", title: "Normen eines Projekts prüfen" },
    ],
  },
  {
    id: "benutzer",
    num: 3,
    title: "Benutzer erstellen und berechtigen",
    short: "Benutzer",
    desc: "Einladen, Rollen vergeben, Projekten zuweisen",
    secondary: true,
    sections: [
      { id: "rollen", title: "Die Rollen im Überblick" },
      { id: "einladen", title: "Eine Person einladen" },
      { id: "rolle-aendern", title: "Rolle ändern oder Zugang entfernen" },
      { id: "projekt-zuweisen", title: "Personen einem Projekt zuweisen" },
    ],
  },
];

export function sectionTitle(id: string): string {
  for (const c of CHAPTERS) {
    const s = c.sections.find((x) => x.id === id);
    if (s) return s.title;
  }
  throw new Error(`Unbekannter Handbuch-Abschnitt: ${id}`);
}
