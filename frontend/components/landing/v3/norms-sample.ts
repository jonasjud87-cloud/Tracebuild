export type NormWork = "IBN" | "VBK" | "Kantonal";

type SampleNorm = {
  id: string;
  code: string;
  title: string;
  work: NormWork;
  canton: string | null;
  theme: string;
  updated: string;
  breadcrumb: string;
  body: string;
  clause: string;
  related: string[];
};

export const SAMPLE_NORMS: SampleNorm[] = [
  {
    id: "mbg-12",
    code: "§ 12 MBG (Beispiel)",
    title: "Grenzabstand für Hochbauten",
    work: "Kantonal",
    canton: "MK",
    theme: "Grenzabstand",
    updated: "08/2026",
    breadcrumb: "Musterbaugesetz MK · 5. Titel · § 12",
    body:
      "Der kleine Grenzabstand beträgt 4.00 m, der grosse Grenzabstand 7.00 m. Für Gebäude mit mehr als drei Vollgeschossen erhöht sich der grosse Grenzabstand um 1.20 m je zusätzliches Vollgeschoss.",
    clause: "Der kleine Grenzabstand beträgt 4.00 m, der grosse Grenzabstand 7.00 m.",
    related: ["mzo-3", "mbg-14", "ibn-480"],
  },
  {
    id: "mbg-14",
    code: "§ 14 MBG (Beispiel)",
    title: "Näherbaurecht und Grenzbaurecht",
    work: "Kantonal",
    canton: "MK",
    theme: "Grenzabstand",
    updated: "03/2026",
    breadcrumb: "Musterbaugesetz MK · 5. Titel · § 14",
    body:
      "Mit schriftlicher Zustimmung der Nachbarschaft, die im Grundbuch anzumerken ist, darf der Grenzabstand unterschritten oder an die Grenze gebaut werden. Der Gebäudeabstand bleibt in jedem Fall einzuhalten.",
    clause: "Der Gebäudeabstand bleibt in jedem Fall einzuhalten.",
    related: ["mbg-12", "mzo-3"],
  },
  {
    id: "mzo-7",
    code: "Art. 7 MZO (Beispiel)",
    title: "Gebäudehöhe in der Wohnzone W3",
    work: "Kantonal",
    canton: "MK",
    theme: "Gebäudehöhe",
    updated: "01/2026",
    breadcrumb: "Musterzonenordnung MK · Zonenvorschriften · Art. 7",
    body:
      "In der Wohnzone W3 beträgt die zulässige Gebäudehöhe 10.00 m, gemessen ab dem gewachsenen Terrain bis zur Schnittlinie der Fassade mit der Dachhaut. Für Flachdachbauten gilt die Höhe bis Oberkant Attika.",
    clause: "die zulässige Gebäudehöhe 10.00 m",
    related: ["mbg-12", "ibn-440"],
  },
  {
    id: "mzo-3",
    code: "Art. 3 MZO (Beispiel)",
    title: "Ausnützungsziffer und anrechenbare Geschossfläche",
    work: "Kantonal",
    canton: "MK",
    theme: "Ausnützung",
    updated: "11/2025",
    breadcrumb: "Musterzonenordnung MK · Allgemeines · Art. 3",
    body:
      "Die Ausnützungsziffer ist das Verhältnis der anrechenbaren Geschossfläche zur anrechenbaren Grundstücksfläche. Nicht angerechnet werden Flächen mit einer lichten Höhe unter 1.00 m sowie notwendige Nebenräume im Untergeschoss.",
    clause: "Verhältnis der anrechenbaren Geschossfläche zur anrechenbaren Grundstücksfläche",
    related: ["mzo-7", "ibn-440"],
  },
  {
    id: "ibn-480",
    code: "IBN 480 (Beispiel)",
    title: "Hindernisfreie Bauten",
    work: "IBN",
    canton: null,
    theme: "Hindernisfreiheit",
    updated: "06/2026",
    breadcrumb: "IBN 480 · 3 Anforderungen · 3.4",
    body:
      "Türen in der hindernisfreien Erschliessung müssen eine lichte Durchgangsbreite von mindestens 0.90 m aufweisen. Vor und nach der Tür ist eine horizontale Bewegungsfläche von mindestens 1.50 m Länge vorzusehen.",
    clause: "lichte Durchgangsbreite von mindestens 0.90 m",
    related: ["ibn-140", "vbk-210"],
  },
  {
    id: "ibn-381",
    code: "IBN 381/1 (Beispiel)",
    title: "Heizwärmebedarf",
    work: "IBN",
    canton: null,
    theme: "Energie",
    updated: "08/2026",
    breadcrumb: "IBN 381/1 · 3 Grenzwerte · 3.1",
    body:
      "Der Heizwärmebedarf Qh darf den projektbezogenen Grenzwert Qh,li nicht überschreiten. Der Grenzwert ist abhängig von der thermischen Gebäudehüllfläche im Verhältnis zur Energiebezugsfläche.",
    clause: "darf den projektbezogenen Grenzwert Qh,li nicht überschreiten",
    related: ["ibn-381-2", "ibn-170"],
  },
  {
    id: "ibn-381-2",
    code: "IBN 381/2 (Beispiel)",
    title: "Kühlleistung und Klimatisierung",
    work: "IBN",
    canton: null,
    theme: "Energie",
    updated: "02/2026",
    breadcrumb: "IBN 381/2 · 4 Nachweis · 4.2",
    body:
      "Eine aktive Kühlung ist nur zulässig, wenn der sommerliche Wärmeschutz nach IBN 170 nachgewiesen ist und die installierte Kälteleistung 18 W/m² Energiebezugsfläche nicht übersteigt.",
    clause: "die installierte Kälteleistung 18 W/m² Energiebezugsfläche nicht übersteigt",
    related: ["ibn-381", "ibn-170"],
  },
  {
    id: "ibn-170",
    code: "IBN 170 (Beispiel)",
    title: "Wärmeschutz, Feuchteschutz und Raumklima",
    work: "IBN",
    canton: null,
    theme: "Bauphysik",
    updated: "05/2026",
    breadcrumb: "IBN 170 · 5 Sommerlicher Wärmeschutz · 5.3",
    body:
      "Ohne aktive Kühlung darf die operative Raumtemperatur an höchstens 120 Stunden pro Jahr über der oberen Komfortgrenze liegen. Massgebend ist das Klimadatenjahr des Standortkantons.",
    clause: "höchstens 120 Stunden pro Jahr über der oberen Komfortgrenze",
    related: ["ibn-381", "ibn-381-2"],
  },
  {
    id: "ibn-171",
    code: "IBN 171 (Beispiel)",
    title: "Schallschutz im Hochbau",
    work: "IBN",
    canton: null,
    theme: "Schallschutz",
    updated: "09/2025",
    breadcrumb: "IBN 171 · 3 Anforderungen · Tab. 3",
    body:
      "Zwischen fremden Nutzungseinheiten ist ein bewerteter Schallschutz von mindestens 54 dB für Luftschall einzuhalten. Bei erhöhten Anforderungen erhöht sich der Wert um 4 dB.",
    clause: "bewerteter Schallschutz von mindestens 54 dB für Luftschall",
    related: ["ibn-140", "ibn-170"],
  },
  {
    id: "ibn-250",
    code: "IBN 250 (Beispiel)",
    title: "Einwirkungen auf Tragwerke",
    work: "IBN",
    canton: null,
    theme: "Tragwerk",
    updated: "04/2026",
    breadcrumb: "IBN 250 · 5 Schnee und Wind · 5.2",
    body:
      "Die charakteristische Schneelast auf dem Boden sk ist standortabhängig und beträgt im Beispielgebiet mindestens 1.10 kN/m². Für Bauhöhen über 900 m ü. M. ist sk nach Anhang D zu bestimmen.",
    clause: "beträgt im Beispielgebiet mindestens 1.10 kN/m²",
    related: ["ibn-221", "ibn-440"],
  },
  {
    id: "ibn-221",
    code: "IBN 221/1 (Beispiel)",
    title: "Geneigte Dächer",
    work: "IBN",
    canton: null,
    theme: "Dach",
    updated: "07/2026",
    breadcrumb: "IBN 221/1 · 2 Konstruktion · 2.5",
    body:
      "Bei Dachneigungen unter 22° ist eine zusätzliche wasserdichte Unterdachbahn erforderlich. Die Mindestüberdeckung der Ziegel richtet sich nach Neigung, Regionalklima und Regeldachneigung des Produkts.",
    clause: "Bei Dachneigungen unter 22° ist eine zusätzliche wasserdichte Unterdachbahn erforderlich.",
    related: ["ibn-250", "ibn-260"],
  },
  {
    id: "ibn-260",
    code: "IBN 260 (Beispiel)",
    title: "Abdichtungen von Hochbauten",
    work: "IBN",
    canton: null,
    theme: "Dach",
    updated: "12/2025",
    breadcrumb: "IBN 260 · 4 Anschlüsse · 4.3",
    body:
      "Abdichtungen sind an aufgehenden Bauteilen mindestens 120 mm über die fertige Oberfläche hochzuziehen. Bei begrünten Flächen erhöht sich das Mass auf 180 mm.",
    clause: "mindestens 120 mm über die fertige Oberfläche hochzuziehen",
    related: ["ibn-221", "ibn-260"],
  },
  {
    id: "ibn-440",
    code: "IBN 440 (Beispiel)",
    title: "Flächen und Volumen von Gebäuden",
    work: "IBN",
    canton: null,
    theme: "Ausnützung",
    updated: "10/2025",
    breadcrumb: "IBN 440 · 3 Definitionen · 3.2",
    body:
      "Die Geschossfläche GF umfasst die Grundfläche aller Geschosse einschliesslich Konstruktionsflächen. Nicht dazu zählen Flächen ausserhalb der Gebäudehülle wie offene Balkone und auskragende Vordächer.",
    clause: "einschliesslich Konstruktionsflächen",
    related: ["mzo-3", "mzo-7"],
  },
  {
    id: "ibn-140",
    code: "IBN 140 (Beispiel)",
    title: "Allgemeine Bedingungen für Bauarbeiten",
    work: "IBN",
    canton: null,
    theme: "Vertrag",
    updated: "03/2026",
    breadcrumb: "IBN 140 · Art. 58 · Abs. 1",
    body:
      "Die Abnahme des Werks erfolgt gemeinsam durch Bauherrschaft und Unternehmer. Ab Abnahme läuft die einjährige Rügefrist; verdeckte Mängel können während der Verjährungsfrist von vier Jahren geltend gemacht werden.",
    clause: "Ab Abnahme läuft die einjährige Rügefrist",
    related: ["ibn-480", "ibn-171"],
  },
  {
    id: "vbk-210",
    code: "VBK 210 (Beispiel)",
    title: "Parkieren – Angebot an Parkfeldern",
    work: "VBK",
    canton: null,
    theme: "Parkierung",
    updated: "06/2026",
    breadcrumb: "VBK 210 · 5 Bedarf · 5.1",
    body:
      "Für Wohnnutzungen ist als Richtwert ein Parkfeld je 90 m² Bruttogeschossfläche vorzusehen, mindestens jedoch ein Parkfeld je Wohnung. Kommunale Reduktionen bei guter ÖV-Erschliessung bleiben vorbehalten.",
    clause: "ein Parkfeld je 90 m² Bruttogeschossfläche",
    related: ["ibn-480", "mzo-3"],
  },
  {
    id: "mgs-9",
    code: "Art. 9 MGSchV (Beispiel)",
    title: "Gewässerraum – Bauverbot",
    work: "Kantonal",
    canton: "MS",
    theme: "Gewässerabstand",
    updated: "05/2026",
    breadcrumb: "Mustergewässerschutzverordnung MS · 4a · Art. 9",
    body:
      "Im Gewässerraum dürfen nur standortgebundene, im öffentlichen Interesse liegende Anlagen erstellt werden. Bestehende Bauten geniessen Bestandesgarantie, dürfen aber nicht erweitert werden.",
    clause: "dürfen nur standortgebundene, im öffentlichen Interesse liegende Anlagen erstellt werden",
    related: ["mwg-5", "mbg-12"],
  },
  {
    id: "mwg-5",
    code: "Art. 5 MWaG (Beispiel)",
    title: "Waldabstand für Bauten",
    work: "Kantonal",
    canton: "MS",
    theme: "Waldabstand",
    updated: "02/2026",
    breadcrumb: "Musterwaldgesetz MS · 3 · Art. 5",
    body:
      "Bauten und Anlagen haben einen Mindestabstand von 25 m zum Waldrand einzuhalten. Die zuständige Stelle kann Ausnahmen bis 12 m bewilligen, wenn keine überwiegenden Interessen entgegenstehen.",
    clause: "Mindestabstand von 25 m zum Waldrand",
    related: ["mgs-9"],
  },
];

export const THEMES = Array.from(new Set(SAMPLE_NORMS.map((n) => n.theme))).sort();
export const CANTONS = Array.from(
  new Set(SAMPLE_NORMS.map((n) => n.canton).filter((c): c is string => !!c))
).sort();
export const WORKS: NormWork[] = ["IBN", "VBK", "Kantonal"];

export function findNorm(id: string) {
  return SAMPLE_NORMS.find((n) => n.id === id);
}
