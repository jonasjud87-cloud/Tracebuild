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
    short: "Pläne",
    desc: "Projekt anlegen, Parzelle und Normen ansehen, Pläne prüfen lassen, Ergebnis lesen, neue Versionen prüfen",
    sections: [
      { id: "projekt-anlegen", title: "Projekt anlegen" },
      { id: "vor-der-analyse", title: "Vor der Plan-Analyse: Was TraceBuild zur Parzelle zeigt" },
      { id: "grundstueck", title: "Grundstück und Bauzone kontrollieren" },
      { id: "plan-hochladen", title: "Pläne hochladen und prüfen lassen" },
      { id: "ergebnis", title: "Ergebnis lesen und exportieren" },
      { id: "neue-version", title: "Überarbeitete Pläne prüfen" },
      { id: "fehlgeschlagen", title: "Wenn eine Analyse fehlschlägt" },
    ],
  },
  {
    id: "normen",
    num: 2,
    title: "Normen eines Projekts",
    short: "Normen",
    desc: "Welche Vorschriften gelten, ÖREB-Auszug, Reglemente, Spezialnormen",
    sections: [
      { id: "projekt-normen", title: "Reiter Normen lesen" },
      { id: "normtext", title: "Normtext ansehen" },
      { id: "reglemente", title: "Reglemente aus dem ÖREB-Kataster" },
      { id: "spezialnorm", title: "Spezialnorm hinzufügen und Normen neu laden" },
    ],
  },
  {
    id: "werkzeuge",
    num: 3,
    title: "Normenblatt und KI Chat",
    short: "Normenblatt & Chat",
    desc: "Kenndaten der Bauzone als Blatt, Fragen zum Projekt stellen",
    sections: [
      { id: "normenblatt", title: "Normenblatt erstellen" },
      { id: "chat", title: "Fragen im KI Chat" },
    ],
  },
  {
    id: "einstellungen",
    num: 4,
    title: "Übersicht und Projekte verwalten",
    short: "Verwalten",
    desc: "Startseite, Projektdaten, Parzelle, Bauzone, Projekt löschen",
    secondary: true,
    sections: [
      { id: "uebersicht", title: "Startseite «Übersicht»" },
      { id: "projektdaten", title: "Projektdaten und Parzelle ändern" },
      { id: "projekt-loeschen", title: "Projekt löschen" },
    ],
  },
  {
    id: "unternehmensnormen",
    num: 5,
    title: "Unternehmensnormen",
    short: "Unternehmensnormen",
    desc: "Eigene Richtlinien und eigene Fassungen von Gesetzen hinterlegen",
    secondary: true,
    sections: [
      { id: "bereiche", title: "Die drei Bereiche" },
      { id: "unternehmensnorm", title: "Unternehmensnorm hochladen und freigeben" },
      { id: "eigene-fassung", title: "Eigene Fassung eines Gesetzes hochladen" },
    ],
  },
  {
    id: "benutzer",
    num: 6,
    title: "Benutzer und Rollen",
    short: "Benutzer",
    desc: "Einladen, Rollen vergeben, Projekten zuweisen, eigenes Profil",
    secondary: true,
    sections: [
      { id: "rollen", title: "Die Rollen im Überblick" },
      { id: "einladen", title: "Eine Person einladen" },
      { id: "rolle-aendern", title: "Rolle ändern oder Zugang entfernen" },
      { id: "projekt-zuweisen", title: "Personen einem Projekt zuweisen" },
      { id: "profil", title: "Eigenes Profil" },
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
