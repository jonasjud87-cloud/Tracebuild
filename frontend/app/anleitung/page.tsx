import type { Metadata } from "next";
import Image, { type StaticImageData } from "next/image";
import "@/components/landing/v3/landing.css";
import LandingShell from "@/components/landing/v3/LandingShell";
import Navbar from "@/components/landing/v3/Navbar";
import Footer from "@/components/landing/v3/Footer";
import ChapterNav from "./ChapterNav";
import RevealOnScroll from "./RevealOnScroll";
import { CHAPTERS, sectionTitle, type HandbookChapter } from "./chapters";
import s from "./anleitung.module.css";

import imgMitglieder from "./img/mitglieder.jpg";
import imgEinladen from "./img/einladen.jpg";
import imgProjektmitglieder from "./img/projektmitglieder.jpg";
import imgProjektNormen from "./img/projekt-normen.jpg";
import imgProjekte from "./img/projekte.jpg";
import imgUpload from "./img/upload.jpg";
import imgErgebnis from "./img/ergebnis.jpg";
import imgPruefpunkt from "./img/pruefpunkt.png";
import imgPlanAnalyse from "./img/plan-analyse.jpg";

// Handbuch für Organisationen. Bewusst nur per Direktlink erreichbar: nirgends
// in der App verlinkt, öffentlich in middleware.ts (PUBLIC_PATHS) und für
// Suchmaschinen gesperrt. Schwerpunkt sind die Kapitel zur Planprüfung; die
// Einrichtungsthemen stehen danach unter «Weitere Themen».
// Beschriftungen in <Ui> stammen wörtlich aus dem Code. Welche Screenshots
// veraltet sind und wie sie neu aufgenommen werden: docs/anleitung-screenshots.md.

const FEEDBACK_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSesqu-mx6u9mfcJkjfO7VD0_a0ucoCYEd0RpPK2LCsh81yDJQ/viewform";

export const metadata: Metadata = {
  title: "Anleitung - TraceBuild",
  description:
    "Handbuch für Organisationen: Pläne analysieren, Normen eines Projekts, Normenblatt, Unternehmensnormen, Benutzer.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

const MAIN = CHAPTERS.filter((c) => !c.secondary);
const MORE = CHAPTERS.filter((c) => c.secondary);

const QUICKSTART = [
  {
    href: "#projekt-anlegen",
    title: "Projekt anlegen",
    text: "Adresse oder Parzelle suchen. TraceBuild füllt die Angaben aus und ermittelt die Bauzone aus dem ÖREB-Kataster.",
  },
  {
    href: "#plan-hochladen",
    title: "Pläne hochladen",
    text: "Alle Pläne des Projekts zusammen hochladen und die Analyse starten.",
  },
  {
    href: "#ergebnis",
    title: "Ergebnis lesen",
    text: "Verstösse, unklare und konforme Punkte, jeweils mit Begründung, Datei und Seite.",
  },
];

interface FieldRow {
  field: string;
  what: string;
  example: string;
  optional?: boolean;
}

const PROJECT_FIELDS: FieldRow[] = [
  { field: "Adresse oder Parzelle suchen", what: "Sucht das Grundstück bei swisstopo und füllt die Felder darunter", example: "Herisau 859", optional: true },
  { field: "Projektname", what: "Name, unter dem das Projekt erscheint", example: "Neubau Wohnhaus" },
  { field: "Projektnummer", what: "Ihre interne Nummer, in der Organisation eindeutig", example: "2024-017", optional: true },
  { field: "Kanton", what: "Alle Kantone und FL (Liechtenstein)", example: "AR" },
  { field: "Gemeinde", what: "Gemeinde des Grundstücks", example: "Herisau" },
  { field: "Parzellennummer", what: "Nummer im Grundbuch; entfällt, wenn die Suche das Grundstück eindeutig gefunden hat", example: "859" },
  { field: "Bauzone", what: "Leer lassen: TraceBuild ermittelt sie aus dem ÖREB-Kataster", example: "W2", optional: true },
];

const PROJECT_TABS = [
  { tab: "Plan-Analyse", what: "Grundstück, Prüfungen, Versionen und Ergebnisse" },
  { tab: "Normen", what: "Welche Vorschriften für dieses Grundstück gelten" },
  { tab: "KI Chat", what: "Fragen zum Projekt, zu den Normen und zur letzten Analyse" },
  { tab: "Normenblatt", what: "Kenndaten der Bauzone als Blatt und PDF" },
  { tab: "Einstellungen", what: "Projektdaten, Parzelle, Bauzone, Projekt löschen" },
];

const DELTA_LABELS = [
  { label: "Behoben", what: "War ein Verstoss oder unklar, ist jetzt konform." },
  { label: "Verbessert", what: "War ein Verstoss, ist jetzt nur noch unklar." },
  { label: "Verschlechtert", what: "Ist strenger bewertet als in der Vorversion." },
  { label: "Angepasst", what: "Gleiche Bewertung, die Feststellung wurde an den neuen Plan angepasst." },
  { label: "Nicht mehr prüfbar", what: "Lässt sich im neuen Plan nicht mehr beurteilen, z. B. weil eine Unterlage fehlt." },
  { label: "Neu", what: "Kam in der Vorversion nicht vor." },
];

const COMPANY_FIELDS: FieldRow[] = [
  { field: "Kategorie", what: "Das Thema der Richtlinie", example: "Brandschutz" },
  { field: "Bezeichnung (optional)", what: "Name des Dokuments", example: "Brandschutzrichtlinie 2026", optional: true },
  { field: "Zone (optional)", what: "Leer lassen, wenn sie für alle Zonen gilt", example: "W2", optional: true },
  { field: "Verbindlichkeit", what: "Verbindlich: Abweichung gilt als Mangel. Empfehlung: höchstens ein Hinweis.", example: "Verbindlich" },
  { field: "Gilt für", what: "Alle Projekte, Bestimmte Kantone oder Bestimmte Projekte", example: "Alle Projekte" },
];

const LAW_FIELDS: FieldRow[] = [
  { field: "Ebene", what: "Wer die Norm erlassen hat: Bund, Kanton oder Gemeinde", example: "Gemeinde" },
  { field: "Kanton", what: "Wo die Norm gilt", example: "SG" },
  { field: "Gemeinde", what: "Nur bei Ebene Gemeinde", example: "Mels" },
  { field: "Kategorie", what: "Das Thema der Norm", example: "Grenzabstand" },
  { field: "Quelle (optional)", what: "Erlass, Artikel oder Paragraf", example: "PBG ZH § 270", optional: true },
  { field: "Zone (optional)", what: "Leer lassen, wenn die Norm für alle Zonen gilt", example: "W2", optional: true },
];

function Ui({ children }: { children: React.ReactNode }) {
  return <span className={s.ui}>{children}</span>;
}

function Sub({ id }: { id: string }) {
  return <h3 id={id}>{sectionTitle(id)}</h3>;
}

/** Abbildung. `frueher`: Aufnahme im früheren Design, Ablauf stimmt noch. */
function Fig({
  src,
  alt,
  caption,
  narrow,
  frueher,
}: {
  src: StaticImageData;
  alt: string;
  caption: string;
  narrow?: boolean;
  frueher?: boolean;
}) {
  return (
    <figure className={`${s.figure} ${narrow ? s.narrow : ""}`}>
      <Image src={src} alt={alt} sizes="(max-width: 880px) 100vw, 848px" />
      <figcaption>
        {frueher && <span className={s.figTag}>Frühere Ansicht</span>}
        {caption}
      </figcaption>
    </figure>
  );
}

function Fields({ rows, label }: { rows: FieldRow[]; label: string }) {
  return (
    <div className={`${s.tableWrap} ${s.fieldTable}`}>
      <table aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Feld</th>
            <th scope="col">Was eintragen</th>
            <th scope="col">Beispiel</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.field}>
              <td>
                <Ui>{f.field}</Ui>
                {f.optional && <span className={s.optional}>optional</span>}
              </td>
              <td>{f.what}</td>
              <td className={s.example}>{f.example}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.note}>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function Chapter({ id, children }: { id: string; children: React.ReactNode }) {
  const c = CHAPTERS.find((x) => x.id === id)!;
  return (
    <section
      className={`${s.chapter} ${c.secondary ? s.chapterSecondary : ""}`}
      id={c.id}
      aria-labelledby={`${c.id}-titel`}
    >
      <div className={s.wrap}>
        <h2 id={`${c.id}-titel`}>
          <span className={s.num}>{c.num}</span>
          {c.title}
        </h2>
        {children}
      </div>
    </section>
  );
}

function TocSections({ c }: { c: HandbookChapter }) {
  return (
    <ol className={s.tocSections}>
      {c.sections.map((x, i) => (
        <li key={x.id}>
          <a href={`#${x.id}`}>
            <span className={s.tocSectionNum}>
              {c.num}.{i + 1}
            </span>
            <span>{x.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export default function AnleitungPage() {
  return (
    <LandingShell>
      <a href="#tb-main" className="tbl-skip">
        Zum Inhalt springen
      </a>
      <Navbar offsite />
      <div className={s.page}>
        <ChapterNav />
        <RevealOnScroll selector={`.${s.chapter} .${s.wrap} > *, .${s.quickSteps} > li, .${s.toc} > li`} />

        <main id="tb-main">
          <header className={s.hero}>
            <div className={s.heroInner}>
              <p className={s.pill}>Anleitung</p>
              <h1>Ihr Bauplan, in wenigen Minuten geprüft</h1>
              <p className={s.lead}>
                Sie laden einen Plan hoch, TraceBuild prüft ihn gegen die Vorschriften, die für Ihre Parzelle gelten:
                Bauzone, Abstände, Höhen und mehr. Sie sehen auf einen Blick, was eingehalten ist, wo etwas nicht
                stimmt und wo es noch Angaben braucht.
              </p>
              <p className={s.meta}>Handbuch für Organisationen · Stand 19. November 2026</p>
            </div>
          </header>

          <div className={`${s.wrap} ${s.intro}`}>
            <aside className={s.testphase} aria-label="Testphase">
              <p className={s.testphaseLabel}>Testphase</p>
              <p className={s.testphaseTitle}>Willkommen bei TraceBuild!</p>
              <p>
                Schön, dass Sie dabei sind. TraceBuild befindet sich in der Testphase, und Sie gehören zu den Ersten,
                die es nutzen. Probieren und testen Sie alles in Ruhe. Diese Anleitung führt Sie Schritt für Schritt
                durch.
              </p>
              <p>
                Ist Ihnen ein Fehler aufgefallen, wirkt etwas unklar oder fehlt Ihnen eine Funktion? Erfassen Sie es
                bitte in unserem Formular. Jede Rückmeldung hilft uns, TraceBuild besser zu machen.
              </p>
              <a className={s.testphaseCta} href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer">
                Fehler oder Feedback melden <span aria-hidden="true">↗</span>
              </a>
            </aside>

            <section className={s.quick} aria-labelledby="schnellstart-titel">
              <h2 id="schnellstart-titel" className={s.quickTitle}>
                In drei Schritten zur ersten Prüfung
              </h2>
              <ol className={s.quickSteps}>
                {QUICKSTART.map((q, i) => (
                  <li key={q.href}>
                    <a href={q.href}>
                      <span className={s.quickNum}>{i + 1}</span>
                      <span className={s.quickStepTitle}>{q.title}</span>
                      <span className={s.quickText}>{q.text}</span>
                      <span className={s.quickMore}>
                        Anleitung <span aria-hidden="true">→</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </section>

            <nav id="inhalt" aria-labelledby="inhalt-titel" className={s.tocNav}>
              <h2 id="inhalt-titel" className={s.tocTitle}>
                Inhalt
              </h2>
              <ol className={s.toc}>
                {MAIN.map((c) => (
                  <li key={c.id} className={`${s.tocCard} ${s.tocCardMain}`}>
                    <a className={s.tocChapter} href={`#${c.id}`}>
                      <span className={s.tocN}>Kapitel {c.num}</span>
                      <span className={s.tocT}>{c.title}</span>
                      <span className={s.tocD}>{c.desc}</span>
                    </a>
                    <TocSections c={c} />
                  </li>
                ))}
              </ol>

              <h3 className={s.tocTitle}>Weitere Themen</h3>
              <ol className={`${s.toc} ${s.tocMore}`}>
                {MORE.map((c) => (
                  <li key={c.id} className={s.tocCard}>
                    <a className={s.tocChapter} href={`#${c.id}`}>
                      <span className={s.tocN}>Kapitel {c.num}</span>
                      <span className={s.tocT}>{c.title}</span>
                    </a>
                    <TocSections c={c} />
                  </li>
                ))}
              </ol>
            </nav>
          </div>

          {/* ── Kapitel 1 ─────────────────────────────────────────────── */}
          <Chapter id="plaene">
            <p className={s.chapterLead}>
              Für jede Prüfung braucht es ein Projekt mit Parzelle. Darin laden Sie alle Pläne des Baugesuchs zusammen
              hoch (Situation, Grundrisse, Schnitte, Fassaden, Berechnungen), denn erst zusammen ist der Plansatz
              vollständig. Geprüft wird gegen den ÖREB-Auszug der Parzelle, die Normen des Projekts (siehe{" "}
              <a href="#normen">Kapitel 2</a>) und die freigegebenen Unternehmensnormen Ihrer Organisation (siehe{" "}
              <a href="#unternehmensnormen">Kapitel 5</a>).
            </p>

            <Sub id="projekt-anlegen" />
            <ol className={s.steps}>
              <li><p>Klicken Sie in der linken Navigation auf <Ui>Projekte</Ui> und dann auf <Ui>+ Neues Projekt</Ui>. Ist die Liste noch leer, heisst der Knopf <Ui>Erstes Projekt erstellen →</Ui>.</p></li>
              <li><p>Tippen Sie im Feld <Ui>Adresse oder Parzelle suchen</Ui> eine Adresse oder Gemeinde und Parzellennummer ein, z.&nbsp;B. «Herisau 859», und wählen Sie den Treffer. TraceBuild füllt <Ui>Kanton</Ui>, <Ui>Gemeinde</Ui> und <Ui>Parzellennummer</Ui> aus. Passen mehrere Grundstücke, wählen Sie das richtige. Ohne Treffer tragen Sie die Felder von Hand ein.</p></li>
              <li><p>Geben Sie den <Ui>Projektname</Ui> ein, auf Wunsch auch Ihre <Ui>Projektnummer</Ui>. Die Nummer erscheint danach auf der Projektkarte und im Projekt oben neben dem Namen.</p></li>
              <li><p>Die <Ui>Bauzone</Ui> lassen Sie leer. TraceBuild ermittelt sie aus dem ÖREB-Kataster; Ihre Angabe gilt nur, wenn der Kataster keine sichere Zone liefert.</p></li>
              <li><p>Klicken Sie auf <Ui>Projekt erstellen →</Ui>. Während der ÖREB-Auszug abgerufen wird, steht auf dem Knopf <Ui>ÖREB-Auszug wird abgerufen…</Ui>. Danach öffnet sich das Projekt im Reiter <Ui>Plan-Analyse</Ui>.</p></li>
            </ol>
            <Fields rows={PROJECT_FIELDS} label="Felder im Dialog Projekt erstellen" />
            <Note title="Liechtenstein">
              <p>
                Wählen Sie als Kanton <Ui>FL (Liechtenstein)</Ui>. TraceBuild ruft auch dort den ÖREB-Auszug ab und
                prüft nach liechtensteinischem Baurecht, nicht nach Schweizer Recht.
              </p>
            </Note>
            <p>
              In der Projektübersicht wechseln Sie zwischen Kachel- und Listenansicht und finden ein Projekt über{" "}
              <Ui>Projekt suchen…</Ui>. Jedes Projekt hat oben fünf Reiter; mit <Ui>Projekte</Ui> oben links kommen
              Sie zurück zur Übersicht.
            </p>
            <div className={s.tableWrap}>
              <table aria-label="Reiter eines Projekts">
                <thead>
                  <tr>
                    <th scope="col">Reiter</th>
                    <th scope="col">Inhalt</th>
                  </tr>
                </thead>
                <tbody>
                  {PROJECT_TABS.map((t) => (
                    <tr key={t.tab}>
                      <td><Ui>{t.tab}</Ui></td>
                      <td>{t.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Fig
              src={imgProjekte}
              frueher
              alt="Projektübersicht mit vier Projektkarten und dem Knopf Neues Projekt"
              caption="Projektübersicht mit allen Projekten der Organisation."
            />

            <Sub id="grundstueck" />
            <p>
              Im Reiter <Ui>Plan-Analyse</Ui> steht oben der Abschnitt <Ui>Grundstück</Ui>. Er zeigt Parzelle,
              Grundstücksnummer (EGRID), die ermittelte Zone und das Datum des ÖREB-Auszugs. Hinter der Zone steht,
              woher sie kommt, z.&nbsp;B. <Ui>aus ÖREB</Ui> oder <Ui>manuell</Ui>.
            </p>
            <ol className={s.steps}>
              <li><p>Steht dort <Ui>Bauzone unsicher, bitte prüfen</Ui> oder <Ui>Bauzone nicht bekannt</Ui>, kontrollieren Sie die Zone. Sie bestimmt, welche Normen geladen werden. Ein Organisations-Admin bestätigt den Vorschlag mit <Ui>Vorschlag bestätigen</Ui> oder trägt die richtige Zone ein und klickt auf <Ui>Speichern</Ui>.</p></li>
              <li><p>Mit <Ui>Neu laden</Ui> holen Sie ÖREB-Auszug und Zusatzdaten neu ab.</p></li>
              <li><p>Unter <Ui>Zusatzdaten und Links</Ui> finden Sie Höhe, ÖV-Güteklasse, ISOS und Gebäude (GWR) sowie Links zum <Ui>Geoportal des Bundes ↗</Ui>, zum <Ui>Kantonales Portal ↗</Ui> und zum <Ui>Amtlicher ÖREB-Auszug (PDF) ↗</Ui>.</p></li>
            </ol>
            <Note title="Wenn kein Auszug kommt">
              <p>
                Meldet der Abschnitt z.&nbsp;B. <Ui>Mehrere Grundstücke passen</Ui> oder <Ui>Grundstück nicht gefunden</Ui>,
                wählt ein Organisations-Admin das Grundstück in den <a href="#projektdaten">Einstellungen</a>. Ist der
                kantonale Dienst nicht erreichbar, tragen Sie die Bauzone von Hand ein und laden später neu. Neuenburg ist
                vorerst nicht automatisch angebunden; dort gilt der amtliche PDF-Auszug.
              </p>
            </Note>

            <Sub id="plan-hochladen" />
            <ol className={s.steps}>
              <li><p>Klicken Sie im Reiter <Ui>Plan-Analyse</Ui> auf <Ui>+ Pläne hochladen</Ui>. Die Prüfung heisst dann <Ui>Baugesuch</Ui>. Einen eigenen Namen vergeben Sie über <Ui>Neue Prüfung</Ui> und <Ui>Erstellen</Ui>, z.&nbsp;B. «Vorabklärung». Eine bestehende Prüfung öffnen Sie über ihre Kachel.</p></li>
              <li><p>Ziehen Sie alle Dateien des Plansatzes auf einmal in das Feld <Ui>Pläne hochladen</Ui> oder klicken Sie hinein. Erlaubt sind PDF und Bilder, bis zu 20 Dateien mit je höchstens 50&nbsp;MB.</p></li>
              <li><p>Kontrollieren Sie die Liste. Mit <Ui>+ Weitere Dateien</Ui> ergänzen Sie, was fehlt, mit <Ui>×</Ui> entfernen Sie eine Datei. Dann klicken Sie auf <Ui>Analyse starten</Ui>.</p></li>
              <li><p>Vor der Prüfung aktualisiert TraceBuild den ÖREB-Auszug und die Reglemente der Gemeinde. Wollen Sie nicht warten, klicken Sie auf <Ui>Ohne Warten starten</Ui>; geprüft wird dann der bisherige Stand.</p></li>
              <li><p>Die Prüfung dauert je nach Umfang einige Minuten. Ein Balken zeigt den Fortschritt. Erscheint der Hinweis, dass Sie die Seite schliessen können, läuft die Analyse auch ohne offene Seite weiter. Mit <Ui>Analyse abbrechen</Ui> stoppen Sie sie.</p></li>
            </ol>
            <Note title="Gut zu wissen">
              <p>
                Pro Projekt läuft immer nur eine Analyse. Eine weitere starten Sie, sobald die laufende abgeschlossen
                ist. Erscheint vor dem Start <Ui>Nicht alle Ebenen sind hinterlegt.</Ui>, fehlt für Kanton oder Gemeinde
                eine Norm; die Prüfung läuft dann nur gegen das, was vorliegt.
              </p>
            </Note>
            <Fig
              src={imgUpload}
              frueher
              alt="Upload-Feld Pläne hochladen für die Prüfung Baugesuch, links die Versionsliste"
              caption="Upload-Feld: alle Dateien des Plansatzes zusammen per Drag & Drop."
            />

            <Sub id="ergebnis" />
            <p>
              Nach der Prüfung öffnet sich das Ergebnis neben der <Ui>Plan-Vorschau</Ui>. Bei mehreren Dateien wählen
              Sie oben in der Vorschau, welche angezeigt wird. Rechts stehen drei Zähler und darunter die Prüfpunkte.
            </p>
            <div className={s.legend}>
              <div className={s.lBad}><b>Verstösse</b>Die Vorschrift ist laut Plan nicht eingehalten. Diese Punkte zuerst bearbeiten.</div>
              <div className={s.lWarn}><b>Unklare Punkte</b>Der Plan enthält nicht genug Angaben für ein eindeutiges Urteil. Fachlich prüfen oder Angaben ergänzen.</div>
              <div className={s.lOk}><b>Konforme Punkte</b>Die Vorschrift ist laut Plan eingehalten.</div>
            </div>
            <Fig
              src={imgErgebnis}
              frueher
              alt="Ergebnisansicht mit Plan-Vorschau links und den Zählern 0 Verstösse, 6 unklare Punkte, 7 konforme Punkte rechts"
              caption="Ergebnis einer Prüfung: Plan-Vorschau links, Prüfpunkte rechts."
            />
            <div className={s.two}>
              <Fig
                src={imgPruefpunkt}
                narrow
                frueher
                alt="Aufgeklappter Prüfpunkt Gebäudehöhe max. 8 m mit Begründung, Seite 8 und Konfidenz Mittel"
                caption="Ein Klick auf einen Prüfpunkt zeigt Begründung, Datei, Seite und Konfidenz."
              />
              <div>
                <ol className={s.steps}>
                  <li><p>Klicken Sie auf einen Prüfpunkt. Er zeigt die Begründung, wo vorhanden einen Vorschlag, die Kategorie, die <Ui>Konfidenz</Ui> (Hoch, Mittel, Gering) sowie Datei und Seite.</p></li>
                  <li><p>Filtern Sie mit <Ui>Alle</Ui>, <Ui>Verstösse</Ui>, <Ui>Warnungen</Ui> oder <Ui>Konform</Ui>, oder klicken Sie auf einen der drei Zähler.</p></li>
                  <li><p>Exportieren Sie den Prüfbericht mit <Ui>Bericht (PDF)</Ui> oder die Mängelliste mit <Ui>CSV</Ui> für Excel.</p></li>
                  <li><p>Offene Punkte aller Prüfungen sehen Sie gesammelt im Reiter <Ui>Plan-Analyse</Ui> unter <Ui>Offene Punkte</Ui>. Mit <Ui>Prüfungen</Ui> kehren Sie aus einer Prüfung dorthin zurück.</p></li>
                </ol>
              </div>
            </div>
            <p>
              Unter den Knöpfen steht der <Ui>ÖREB-Stand</Ui>, gegen den geprüft wurde. Meldet das Ergebnis{" "}
              <Ui>Ergebnis unvollständig</Ui>, konnte ein Teil nicht geprüft werden; die betroffenen Normen sind
              aufgeführt.
            </p>
            <Fig
              src={imgPlanAnalyse}
              frueher
              alt="Übersicht Plan-Analyse mit offenen Punkten der Prüfung Baugesuch"
              caption="Übersicht Plan-Analyse: offene Punkte aller Prüfungen auf einen Blick."
            />

            <Sub id="neue-version" />
            <p>
              Jede Analyse bleibt als Version erhalten (V1, V2, …). Die Versionen stehen links in der Prüfung, mit
              Datum und Anzahl Punkten.
            </p>
            <ol className={s.steps}>
              <li><p>Öffnen Sie die Prüfung und klicken Sie auf <Ui>Neue Version</Ui>. Laden Sie den überarbeiteten Plansatz hoch.</p></li>
              <li><p>Wählen Sie die Art der Prüfung:</p>
                <ul>
                  <li><Ui>Änderungsprüfung</Ui>: prüft die Befunde der letzten Version am neuen Plan nach und sucht Neues. Schneller und günstiger.</li>
                  <li><Ui>Vollprüfung</Ui>: prüft den Plan komplett neu gegen alle Normen.</li>
                </ul>
              </li>
              <li><p>Laden Sie denselben Plan mit denselben Normen nochmals hoch, meldet TraceBuild <Ui>Dieser Plan wurde bereits geprüft.</Ui> Mit <Ui>Ergebnis anzeigen</Ui> öffnen Sie die bestehende Version, ohne Kosten. <Ui>Trotzdem neu prüfen</Ui> startet eine Vollprüfung.</p></li>
              <li><p>Eine Version entfernen Sie über das Menü <Ui>⋮</Ui> neben der Version und <Ui>Version löschen</Ui>.</p></li>
            </ol>
            <p>
              Nach einer Änderungsprüfung steht über den Prüfpunkten eine Zusammenfassung «Änderungsprüfung gegenüber
              Version …». Jeder geänderte Punkt trägt eine Marke; unveränderte Punkte zählt nur die Zusammenfassung:
            </p>
            <div className={s.tableWrap}>
              <table aria-label="Marken der Änderungsprüfung">
                <thead>
                  <tr>
                    <th scope="col">Marke</th>
                    <th scope="col">Bedeutung</th>
                  </tr>
                </thead>
                <tbody>
                  {DELTA_LABELS.map((d) => (
                    <tr key={d.label}>
                      <td><Ui>{d.label}</Ui></td>
                      <td>{d.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note title="Plan stark verändert?">
              <p>
                Weicht der Plan stark von der Vorversion ab, empfiehlt TraceBuild eine Vollprüfung über{" "}
                <Ui>Neue Version</Ui>. War eine Änderungsprüfung nicht möglich, führt TraceBuild selbst eine Vollprüfung
                durch und meldet <Ui>Es wurde eine Vollprüfung durchgeführt</Ui>.
              </p>
            </Note>

            <Sub id="fehlgeschlagen" />
            <p>
              Eine fehlgeschlagene Version trägt in der Liste die Marke <Ui>Fehler</Ui>. Öffnen Sie sie, sehen Sie den
              Grund und eine Referenz für den Support.
            </p>
            <ol className={s.steps}>
              <li><p>Klicken Sie auf <Ui>Erneut versuchen</Ui>. TraceBuild startet eine neue Analyse mit denselben Plänen; Sie müssen nichts neu hochladen.</p></li>
              <li><p>Erscheint statt des Knopfs der Hinweis, dass ein neuer Versuch nicht sinnvoll ist, melden Sie sich mit der Referenz beim Support.</p></li>
              <li><p>Meldet der Fortschritt <Ui>Diese Analyse wurde unterbrochen und läuft nicht weiter.</Ui>, wählen Sie <Ui>Erneut versuchen</Ui> oder <Ui>Analyse entfernen</Ui>.</p></li>
            </ol>

            <Note title="Wichtig">
              <p>
                TraceBuild unterstützt die Planprüfung, ersetzt aber nicht die Beurteilung durch eine Fachperson oder
                die Baubewilligungsbehörde. Unklare Punkte und Verstösse vor der Eingabe fachlich verifizieren.
              </p>
            </Note>
          </Chapter>

          {/* ── Kapitel 2 ─────────────────────────────────────────────── */}
          <Chapter id="normen">
            <p className={s.chapterLead}>
              Der Reiter <Ui>Normen</Ui> zeigt, welche Vorschriften für das Grundstück gelten. TraceBuild stellt sie
              selbst zusammen: aus dem ÖREB-Auszug, den von TraceBuild gepflegten Gesetzen und Reglementen und den Normen
              Ihrer Organisation. Sie ergänzen nur, was fehlt.
            </p>
            <ul className={s.sources}>
              <li>
                <span className={s.sourceTag}>Automatisch</span>
                <strong>ÖREB-Kataster</strong>
                <p>
                  Bauzone und Einschränkungen der Parzelle. Abgerufen beim Anlegen, vor jeder Analyse und mit{" "}
                  <Ui>Neu laden</Ui>. Alle Kantone und Liechtenstein.
                </p>
              </li>
              <li>
                <span className={s.sourceTag}>Für alle Organisationen</span>
                <strong>Gesetzliche Grundlagen</strong>
                <p>Gesetze und Reglemente von Bund, Kanton und Gemeinde, von TraceBuild gepflegt und aktualisiert.</p>
              </li>
              <li>
                <span className={`${s.sourceTag} ${s.sourceTagOwn}`}>Nur Ihre Organisation</span>
                <strong>Unternehmensnormen</strong>
                <p>Eigene Richtlinien und eigene Fassungen von Gesetzen, siehe <a href="#unternehmensnormen">Kapitel 5</a>.</p>
              </li>
            </ul>

            <Sub id="projekt-normen" />
            <ol className={s.steps}>
              <li><p>Oben stehen Gemeinde, Parzelle und Zone. Darunter fasst eine Zeile den ÖREB-Auszug zusammen: Datum, Anzahl Themen, wie viele die Parzelle betreffen und wie viele <Ui>ohne Norm</Ui> sind. <Ui>Amtlicher PDF-Auszug ↗</Ui> öffnet das amtliche Dokument.</p></li>
              <li><p>Die Normen sind nach <Ui>Bund</Ui>, <Ui>Kanton</Ui> und <Ui>Gemeinde</Ui> gruppiert. Marken zeigen die Herkunft, z.&nbsp;B. <Ui>ÖREB</Ui>, <Ui>Plattformweit</Ui> oder <Ui>manuell</Ui>.</p></li>
              <li><p>Unter <Ui>Parzellenspezifisch (ÖREB)</Ui> stehen die Themen des Auszugs, die das Grundstück betreffen. Der Hinweis <Ui>Keine Norm in der Bibliothek für dieses Thema.</Ui> zeigt eine Lücke.</p></li>
              <li><p>Normen, die nur für eine andere Zone gelten, stehen eingeklappt unter <Ui>Andere Zonen — nicht zutreffend</Ui>.</p></li>
              <li><p>Fehlt noch ein Auszug, holen Sie ihn mit <Ui>ÖREB abrufen</Ui>.</p></li>
            </ol>
            <Fig
              src={imgProjektNormen}
              frueher
              alt="Reiter Normen eines Projekts mit ÖREB-Auszug, Zone W2 und parzellenspezifischen Themen"
              caption="Reiter Normen: ÖREB-Auszug der Parzelle, ermittelte Zone und offene Lücken."
            />

            <Sub id="normtext" />
            <ol className={s.steps}>
              <li><p>Klappen Sie eine Norm mit dem Pfeil rechts auf (<Ui>Volltext anzeigen</Ui>).</p></li>
              <li><p>Gegliederte Texte zeigen die Artikel einzeln, längere zusätzlich eine <Ui>Artikelübersicht</Ui>. Mit <Ui>Als Rohtext anzeigen</Ui> sehen Sie den Text ungegliedert, mit <Ui>Gegliedert anzeigen</Ui> wieder gegliedert.</p></li>
              <li><p>Gibt es ein PDF, wechseln Sie auf breiten Bildschirmen zwischen <Ui>Text</Ui> und <Ui>PDF</Ui>. <Ui>Original-PDF öffnen ↗</Ui> öffnet es in einem neuen Fenster.</p></li>
            </ol>

            <Sub id="reglemente" />
            <p>
              Die Baureglemente der Gemeinde übernimmt TraceBuild automatisch aus dem ÖREB-Auszug. Der Abschnitt{" "}
              <Ui>Reglemente aus dem ÖREB-Kataster</Ui> im Reiter <Ui>Normen</Ui> zeigt den Stand.
            </p>
            <ul className={s.bullets}>
              <li>Ein Zähler zeigt den Fortschritt, solange der Import läuft. Analysen sind davon nicht betroffen.</li>
              <li>Abgelehnte Dokumente stehen gelb unter «… abgelehnt, bitte prüfen», nach Grund gruppiert.</li>
              <li>Unter «… bewusst ausgelassen» stehen Dokumente, die nicht in den Import gehören. Das ist kein Fehler.</li>
              <li>Mit <Ui>Dokumente anzeigen</Ui> sehen Sie alle Dokumente mit Status und Link zum amtlichen PDF.</li>
            </ul>

            <Sub id="spezialnorm" />
            <ol className={s.steps}>
              <li><p>Mit <Ui>Spezialnorm hinzufügen</Ui> ergänzen Sie eine Vorschrift nur für dieses Projekt, z.&nbsp;B. einen Sondernutzungsplan. Füllen Sie <Ui>Titel</Ui>, <Ui>Kategorie</Ui>, wenn nötig <Ui>Zone (optional)</Ui>, und <Ui>Inhalt</Ui> aus und klicken Sie auf <Ui>Speichern</Ui>.</p></li>
              <li><p>Nach neuen Uploads oder einer geänderten Zone aktualisieren Sie die Zuordnung mit <Ui>Normen neu laden</Ui>.</p></li>
              <li><p>Eine Norm, die nicht gilt, nehmen Sie mit <Ui>×</Ui> (<Ui>Norm entfernen</Ui>) aus dem Projekt.</p></li>
            </ol>
          </Chapter>

          {/* ── Kapitel 3 ─────────────────────────────────────────────── */}
          <Chapter id="werkzeuge">
            <p className={s.chapterLead}>
              Zwei Hilfen neben der Planprüfung: das Normenblatt fasst die Grundmasse der Bauzone zusammen, der KI Chat
              beantwortet Fragen zum Projekt.
            </p>

            <Sub id="normenblatt" />
            <ol className={s.steps}>
              <li><p>Öffnen Sie den Reiter <Ui>Normenblatt</Ui> und klicken Sie auf <Ui>Normenblatt erstellen</Ui>. TraceBuild liest die Werte aus den zugewiesenen Normen und dem ÖREB-Auszug.</p></li>
              <li><p>Das Blatt zeigt Gemeinde, Parzelle und Datum, darunter die <Ui>Kenndaten</Ui> mit Bezeichnung, Wert und Quelle: z.&nbsp;B. Zone, Landfläche, Vollgeschosse, Ausnützungsziffer, Grenzabstände, Gebäude- und Firsthöhe, Dachform, Strassenabstand. Darunter folgen <Ui>Berechnungen</Ui>.</p></li>
              <li><p>Mit <Ui>PDF herunterladen</Ui> speichern Sie das Blatt als PDF.</p></li>
              <li><p>Ändern sich Normen oder Zone, meldet das Blatt den älteren Stand. Klicken Sie dann auf <Ui>Aktualisieren</Ui>. Mit <Ui>Neu erstellen</Ui> erstellen Sie ein aktuelles Blatt jederzeit neu.</p></li>
            </ol>
            <Note title="Werte am Original prüfen">
              <p>
                Das Normenblatt ist keine behördliche Auskunft. Ein leeres Feld heisst, dass der Wert in den Normen nicht
                sicher gefunden wurde.
              </p>
            </Note>

            <Sub id="chat" />
            <ol className={s.steps}>
              <li><p>Öffnen Sie den Reiter <Ui>KI Chat</Ui>. Der Assistent kennt die Normen des Projekts und die Punkte der letzten Analyse.</p></li>
              <li><p>Stellen Sie Ihre Frage im Eingabefeld und senden Sie sie mit Enter. Shift+Enter fügt eine neue Zeile ein. Für den Anfang bietet TraceBuild Beispielfragen an, z.&nbsp;B. «Welche Normen gelten für dieses Projekt?».</p></li>
              <li><p>Frühere Gespräche stehen links unter <Ui>Verlauf</Ui>. Ein neues Gespräch beginnen Sie mit <Ui>Neuer Chat</Ui>.</p></li>
            </ol>
            <Note title="Nicht rechtsverbindlich">
              <p>Der Chat ersetzt keine Rechtsberatung. Aussagen des Assistenten sind nicht rechtsverbindlich.</p>
            </Note>
          </Chapter>

          <div className={s.more}>
            <div className={`${s.wrap} ${s.moreIntro}`}>
              <p className={s.pill}>Weitere Themen</p>
              <p className={s.moreText}>
                Projekte verwalten, eigene Normen hinterlegen und das Team einrichten. Vieles davon erledigt ein
                Organisations-Admin einmalig; für das Prüfen von Plänen ist es nicht nötig.
              </p>
            </div>

            {/* ── Kapitel 4 ───────────────────────────────────────────── */}
            <Chapter id="einstellungen">
              <p className={s.chapterLead}>
                Im Reiter <Ui>Einstellungen</Ui> bearbeiten Organisations-Admins die Daten eines Projekts. Alle anderen
                sehen die Daten dort nur.
              </p>

              <Sub id="projektdaten" />
              <ol className={s.steps}>
                <li><p>Unter <Ui>Projektdaten</Ui> ändern Sie Projektname, Projektnummer, Kanton, Gemeinde, Parzellennummer und Bauzone. Klicken Sie danach auf <Ui>Speichern</Ui>.</p></li>
                <li><p>Eine von Hand gesetzte Bauzone gilt als manuell und hat Vorrang vor dem ÖREB-Auszug.</p></li>
                <li><p>Ist das Grundstück nicht eindeutig oder falsch, suchen Sie es unter <Ui>Parzelle wählen</Ui> neu und klicken auf <Ui>Diese Parzelle übernehmen</Ui>. Passen mehrere Grundstücke, wählen Sie das richtige aus der Liste. Eine neue Wahl ersetzt Auszug und Zusatzdaten; eine manuell gesetzte Zone bleibt.</p></li>
              </ol>

              <Sub id="projekt-loeschen" />
              <ol className={s.steps}>
                <li><p>Ganz unten unter <Ui>Gefahrenzone</Ui> klicken Sie auf <Ui>Projekt löschen</Ui> und bestätigen die Rückfrage.</p></li>
                <li><p>Das Projekt wird mit allen zugehörigen Daten gelöscht. Das lässt sich nicht rückgängig machen.</p></li>
              </ol>
            </Chapter>

            {/* ── Kapitel 5 ───────────────────────────────────────────── */}
            <Chapter id="unternehmensnormen">
              <p className={s.chapterLead}>
                Eigene Richtlinien und eigene Fassungen von Gesetzen hinterlegen Sie einmal für die ganze Organisation.
                Sie öffnen den Bereich in der linken Navigation unter <Ui>Unternehmensnormen</Ui>.
              </p>

              <Sub id="bereiche" />
              <div className={s.tableWrap}>
                <table aria-label="Bereiche der Unternehmensnormen">
                  <thead>
                    <tr>
                      <th scope="col">Reiter</th>
                      <th scope="col">Inhalt</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><Ui>Unternehmensnormen</Ui></td>
                      <td>Eigene Richtlinien und Standards, z.&nbsp;B. Qualitätsvorgaben oder interne Brandschutzanforderungen.</td>
                    </tr>
                    <tr>
                      <td><Ui>Eigene Fassungen</Ui></td>
                      <td>Gesetze und Reglemente, die Sie selbst hochgeladen haben.</td>
                    </tr>
                    <tr>
                      <td><Ui>Gesetzliche Grundlagen</Ui></td>
                      <td>Von TraceBuild gepflegte Normen für alle Organisationen, nur lesbar, nach Bund, Kanton und Gemeinde gruppiert.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                Über das Suchfeld <Ui>Normen, Gesetze oder Dokumente suchen…</Ui> und die Filter <Ui>Alle Kantone</Ui>{" "}
                und <Ui>Alle Kategorien</Ui> grenzen Sie die Liste ein. <Ui>Inhalt anzeigen</Ui> zeigt den Text einer Norm.
              </p>

              <Sub id="unternehmensnorm" />
              <ol className={s.steps}>
                <li><p>Klicken Sie im Reiter <Ui>Unternehmensnormen</Ui> auf <Ui>Unternehmensnorm hochladen</Ui>.</p></li>
                <li><p>Ziehen Sie eine PDF- oder Textdatei in das Feld oder klicken Sie hinein, und füllen Sie die Felder aus (Tabelle unten).</p></li>
                <li><p>Klicken Sie auf <Ui>Hochladen &amp; speichern</Ui>. Die Norm wird als Entwurf gespeichert und noch nicht geprüft.</p></li>
                <li><p>Ein Organisations-Admin klickt bei der Norm auf <Ui>Freigeben</Ui>. Erst ab dann berücksichtigt TraceBuild sie bei jeder passenden Prüfung.</p></li>
                <li><p>Eine überarbeitete Fassung laden Sie mit <Ui>Neue Version hochladen</Ui> hoch. Sie ersetzt die bisherige erst nach ihrer Freigabe; frühere Versionen bleiben sichtbar. Geltungsbereich und Verbindlichkeit ändert ein Organisations-Admin über <Ui>Einstellungen ändern</Ui>.</p></li>
              </ol>
              <Fields rows={COMPANY_FIELDS} label="Felder einer Unternehmensnorm" />
              <Note title="Rangfolge">
                <p>
                  Gesetzliche Normen gehen immer vor. Eine Unternehmensnorm darf sie verschärfen, aber nie lockern.
                </p>
              </Note>

              <Sub id="eigene-fassung" />
              <p>
                Für ein kommunales Baureglement oder ein kantonales Gesetz, das bei TraceBuild fehlt, laden Sie Ihre
                Fassung hoch. Sie steht danach allen Projekten Ihrer Organisation zur Verfügung.
              </p>
              <ol className={s.steps}>
                <li><p>Wechseln Sie zum Reiter <Ui>Eigene Fassungen</Ui> und klicken Sie auf <Ui>Eigene Fassung hochladen</Ui>.</p></li>
                <li><p>Ziehen Sie die PDF- oder Textdatei in das Feld und ordnen Sie die Norm mit den Feldern unten ein.</p></li>
                <li><p>Klicken Sie auf <Ui>Hochladen &amp; speichern</Ui>.</p></li>
                <li><p>Liegt für dieselbe Gemeinde ein amtlicher Text vor, gilt dieser. Soll trotzdem Ihr Upload gelten, klicken Sie auf <Ui>Meine Fassung als massgebend festlegen</Ui>. Mit <Ui>Festlegung zurücknehmen</Ui> gilt wieder der amtliche Text.</p></li>
              </ol>
              <Fields rows={LAW_FIELDS} label="Felder einer eigenen Fassung" />
            </Chapter>

            {/* ── Kapitel 6 ───────────────────────────────────────────── */}
            <Chapter id="benutzer">
              <p className={s.chapterLead}>
                Neue Personen kommen per Einladung in Ihre Organisation. Einladen und Rechte vergeben kann nur, wer die
                Rolle Org Admin hat. Sie finden die Verwaltung in der linken Navigation unter <Ui>Organisation</Ui>.
              </p>

              <Sub id="rollen" />
              <div className={s.tableWrap}>
                <table aria-label="Rechte der Rollen">
                  <thead>
                    <tr>
                      <th scope="col">Rolle</th>
                      <th scope="col">Pläne prüfen, Normen hochladen, Chat</th>
                      <th scope="col">Bauzone bestätigen, Projekteinstellungen, Projekte löschen</th>
                      <th scope="col">Unternehmensnormen freigeben</th>
                      <th scope="col">Personen einladen, Rollen ändern, Projektmitglieder</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Org Admin</td>
                      <td className={s.yes}>Ja</td>
                      <td className={s.yes}>Ja</td>
                      <td className={s.yes}>Ja</td>
                      <td className={s.yes}>Ja</td>
                    </tr>
                    <tr>
                      <td>Projektleiter</td>
                      <td className={s.yes}>Ja</td>
                      <td className={s.no}>Nein</td>
                      <td className={s.no}>Nein</td>
                      <td className={s.no}>Nein</td>
                    </tr>
                    <tr>
                      <td>Mitglied</td>
                      <td className={s.yes}>Ja</td>
                      <td className={s.no}>Nein</td>
                      <td className={s.no}>Nein</td>
                      <td className={s.no}>Nein</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Note title="Gut zu wissen">
                <p>
                  Alle Personen einer Organisation sehen alle Projekte dieser Organisation. Projektleiter und Mitglied
                  haben dieselben Rechte; die Rolle zeigt im Team, wer für ein Projekt verantwortlich ist.
                </p>
              </Note>

              <Sub id="einladen" />
              <ol className={s.steps}>
                <li><p>Klicken Sie in der linken Navigation auf <Ui>Organisation</Ui>.</p></li>
                <li><p>Wechseln Sie zum Reiter <Ui>Mitglieder</Ui> und klicken Sie auf <Ui>Einladen</Ui>.</p></li>
                <li><p>Füllen Sie <Ui>Name</Ui> und <Ui>E-Mail</Ui> aus und wählen Sie die <Ui>Rolle</Ui>. Bestätigen Sie mit <Ui>Einladen</Ui>.</p></li>
                <li><p>Die Person erhält eine E-Mail, legt über den Link ihr Passwort fest (mindestens 8 Zeichen) und ist danach Teil Ihrer Organisation.</p></li>
              </ol>
              <div className={s.two}>
                <Fig
                  src={imgMitglieder}
                  frueher
                  alt="Reiter Mitglieder mit der Liste der Organisationsmitglieder und dem Knopf Einladen"
                  caption="Organisation → Mitglieder: Liste aller Personen mit ihrer Rolle."
                />
                <Fig
                  src={imgEinladen}
                  frueher
                  alt="Dialog Mitglied einladen mit den Feldern Name, E-Mail und Rolle"
                  caption="Dialog «Mitglied einladen» mit Name, E-Mail und Rolle."
                />
              </div>

              <Sub id="rolle-aendern" />
              <ol className={s.steps}>
                <li><p>Öffnen Sie <Ui>Organisation</Ui> → <Ui>Mitglieder</Ui>.</p></li>
                <li><p>Wählen Sie in der Spalte <Ui>Rolle</Ui> die neue Rolle aus. Die Änderung gilt sofort.</p></li>
                <li><p>Um eine Person zu entfernen, klicken Sie am Zeilenende auf das Papierkorb-Symbol und bestätigen mit <Ui>Entfernen</Ui>.</p></li>
              </ol>

              <Sub id="projekt-zuweisen" />
              <ol className={s.steps}>
                <li><p>Öffnen Sie <Ui>Organisation</Ui> → <Ui>Projekte</Ui>.</p></li>
                <li><p>Klicken Sie in der Zeile des Projekts auf <Ui>Mitglieder</Ui>.</p></li>
                <li><p>Wählen Sie unter <Ui>Mitglied hinzufügen…</Ui> eine Person und klicken Sie auf <Ui>+</Ui>.</p></li>
              </ol>
              <Fig
                src={imgProjektmitglieder}
                frueher
                alt="Seitenleiste Mitglieder eines Projekts mit Auswahlfeld Mitglied hinzufügen"
                caption="Projektmitglieder werden in einer Seitenleiste verwaltet."
              />

              <Sub id="profil" />
              <ol className={s.steps}>
                <li><p>Klicken Sie unten in der linken Navigation auf Ihren Namen, im Projekt oben rechts auf das Personen-Symbol.</p></li>
                <li><p>Auf der Seite <Ui>Profil</Ui> ändern Sie Ihren Namen (<Ui>Name speichern</Ui>), Ihre E-Mail-Adresse (<Ui>E-Mail-Adresse ändern</Ui>) und Ihr Passwort (<Ui>Passwort ändern</Ui>).</p></li>
                <li><p>Eine neue E-Mail-Adresse gilt erst, wenn Sie den Bestätigungslink in der E-Mail an diese Adresse angeklickt haben.</p></li>
              </ol>

              <Note title="Etwas funktioniert nicht wie beschrieben?">
                <p>
                  Melden Sie es uns über das{" "}
                  <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer">
                    Feedback-Formular
                  </a>
                  . Danke!
                </p>
              </Note>
            </Chapter>
          </div>

          <div className={`${s.wrap} ${s.colophon}`}>
            <p>
              Screenshots mit Beispieldaten (Musterbau AG). Bilder mit dem Vermerk «Frühere Ansicht» stammen aus dem
              früheren Design; der Ablauf stimmt, Farben und einzelne Beschriftungen weichen ab.
            </p>
          </div>
        </main>
      </div>
      <Footer offsite />
    </LandingShell>
  );
}
