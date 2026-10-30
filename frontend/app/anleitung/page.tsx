import type { Metadata } from "next";
import Image, { type StaticImageData } from "next/image";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Sans } from "next/font/google";
import ChapterNav from "./ChapterNav";
import { CHAPTERS, sectionTitle, type HandbookChapter } from "./chapters";
import s from "./anleitung.module.css";

import logo from "./img/logo.png";
import imgMitglieder from "./img/mitglieder.jpg";
import imgEinladen from "./img/einladen.jpg";
import imgProjektmitglieder from "./img/projektmitglieder.jpg";
import imgNormHochladen from "./img/norm-hochladen.jpg";
import imgProjektNormen from "./img/projekt-normen.jpg";
import imgProjekte from "./img/projekte.jpg";
import imgProjektErstellen from "./img/projekt-erstellen.jpg";
import imgPlanart from "./img/planart.png";
import imgUpload from "./img/upload.jpg";
import imgErgebnis from "./img/ergebnis.jpg";
import imgPruefpunkt from "./img/pruefpunkt.png";
import imgPlanAnalyse from "./img/plan-analyse.jpg";

// Handbuch für Organisationen. Bewusst nur per Direktlink erreichbar: nirgends
// in der App verlinkt, öffentlich in middleware.ts (PUBLIC_PATHS) und für
// Suchmaschinen gesperrt. Schwerpunkt ist die Planprüfung (Kapitel 1); die
// Einrichtungsthemen stehen danach unter „Weitere Themen“.

const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--hb-body", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--hb-mono", display: "swap" });
const display = Instrument_Sans({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--hb-display", display: "swap" });

const FEEDBACK_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSesqu-mx6u9mfcJkjfO7VD0_a0ucoCYEd0RpPK2LCsh81yDJQ/viewform";

export const metadata: Metadata = {
  title: "Anleitung - TraceBuild",
  description: "Handbuch für Organisationen: Pläne analysieren, Normen hinterlegen, Benutzer berechtigen.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

const MAIN = CHAPTERS.filter((c) => !c.secondary);
const MORE = CHAPTERS.filter((c) => c.secondary);

const QUICKSTART = [
  {
    href: "#projekt-anlegen",
    title: "Projekt anlegen",
    text: "Kanton, Gemeinde und Parzelle eingeben. In SG und AR ermittelt TraceBuild die Bauzone selbst.",
  },
  {
    href: "#plan-hochladen",
    title: "Plan hochladen",
    text: "PDF oder Bild in eine Planart ziehen und die Analyse starten.",
  },
  {
    href: "#ergebnis",
    title: "Ergebnis lesen",
    text: "Verstösse, unklare und konforme Punkte, jeweils mit Begründung und Seitenangabe.",
  },
];

const NORM_FIELDS = [
  { field: "Ebene", what: "Wer die Norm erlassen hat: Bund, Kanton oder Gemeinde", example: "Gemeinde" },
  { field: "Kanton / Gemeinde", what: "Wo die Norm gilt", example: "Mels" },
  { field: "Kategorie", what: "Das Thema der Norm", example: "Grenzabstand" },
  { field: "Zone", what: "Leer lassen, wenn die Norm für alle Zonen gilt", example: "W2", optional: true },
  { field: "Quelle", what: "Erlass, Artikel oder Paragraf", example: "Baureglement Art. 12", optional: true },
];

function Ui({ children }: { children: React.ReactNode }) {
  return <span className={s.ui}>{children}</span>;
}

function Sub({ id }: { id: string }) {
  return <h3 id={id}>{sectionTitle(id)}</h3>;
}

function Fig({ src, alt, caption, narrow }: { src: StaticImageData; alt: string; caption: string; narrow?: boolean }) {
  return (
    <figure className={`${s.figure} ${narrow ? s.narrow : ""}`}>
      <Image src={src} alt={alt} sizes="(max-width: 880px) 100vw, 848px" />
      <figcaption>{caption}</figcaption>
    </figure>
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
    <div className={`${s.page} ${body.variable} ${mono.variable} ${display.variable}`}>
      <ChapterNav />

      <header className={s.masthead}>
        <div className={`${s.wrap} ${s.mastheadInner}`}>
          <a className={s.brand} href="#inhalt" aria-label="TraceBuild, zum Inhaltsverzeichnis">
            <Image src={logo} alt="" width={40} height={40} priority />
            <span className={s.brandName}>
              Trace<b>Build</b>
            </span>
          </a>
          <div className={s.meta}>Handbuch für Organisationen · Stand 30. Oktober 2026</div>
        </div>
      </header>

      <main>
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

          <p className={s.eyebrow}>Anleitung</p>
          <h1>Ihr Bauplan, in wenigen Minuten geprüft</h1>
          <p className={s.lead}>
            Sie laden einen Plan hoch, TraceBuild prüft ihn gegen die Vorschriften, die für Ihre Parzelle gelten:
            Bauzone, Abstände, Höhen und mehr. Sie sehen auf einen Blick, was eingehalten ist, wo etwas nicht
            stimmt und wo es noch Angaben braucht.
          </p>

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

        <Chapter id="plaene">
          <p className={s.chapterLead}>
            Für jede Prüfung braucht es ein Projekt mit Parzelle. Darin legen Sie Planarten an (z.&nbsp;B. Grundriss,
            Schnitt, Fassade) und laden pro Planart die Pläne hoch. Geprüft wird gegen den ÖREB-Auszug der Parzelle
            und die Normen Ihrer Organisation (siehe <a href="#normen">Kapitel 2</a>).
          </p>

          <Sub id="projekt-anlegen" />
          <ol className={s.steps}>
            <li><p>Klicken Sie in der linken Navigation auf <Ui>Projekte</Ui> und dann auf <Ui>+ Neues Projekt</Ui>.</p></li>
            <li><p>Geben Sie <Ui>Projektname</Ui>, <Ui>Kanton</Ui>, <Ui>Gemeinde</Ui> und <Ui>Parzellennummer</Ui> ein.</p></li>
            <li><p>In SG und AR wird die Bauzone automatisch ermittelt. In anderen Kantonen tragen Sie die Bauzone selbst ein oder lassen das Feld leer.</p></li>
            <li><p>Klicken Sie auf <Ui>Projekt erstellen →</Ui>.</p></li>
          </ol>
          <div className={s.two}>
            <Fig
              src={imgProjekte}
              alt="Projektübersicht mit vier Projekten und dem Button Neues Projekt"
              caption="Projektübersicht mit allen Projekten der Organisation."
            />
            <Fig
              src={imgProjektErstellen}
              alt="Dialog Projekt erstellen mit Kanton AR, Gemeinde Herisau und Parzelle 859"
              caption="Neues Projekt in Herisau AR: die Zone kommt aus dem ÖREB-Kataster."
            />
          </div>

          <Sub id="plan-hochladen" />
          <ol className={s.steps}>
            <li><p>Öffnen Sie das Projekt. Im Reiter <Ui>Plan-Analyse</Ui> klicken Sie auf <Ui>Planart hinzufügen</Ui>, geben einen Namen ein (z.&nbsp;B. Fassade Süd) und klicken auf <Ui>Erstellen</Ui>.</p></li>
            <li><p>Ziehen Sie den Plan in das Feld <Ui>Plan hochladen</Ui> oder klicken Sie hinein. Erlaubt sind PDF und Bilder.</p></li>
            <li><p>Kontrollieren Sie Dateiname und Grösse und klicken Sie auf <Ui>Analyse starten</Ui>.</p></li>
            <li><p>Je nach Umfang des Plans kann die Prüfung einige Minuten dauern. Sie können sie jederzeit mit <Ui>Analyse abbrechen</Ui> stoppen.</p></li>
          </ol>
          <Fig src={imgPlanart} alt="Eingabefeld für eine neue Planart mit dem Beispiel Fassade Süd" caption="Neue Planart anlegen." />
          <Fig
            src={imgUpload}
            alt="Upload-Feld Plan hochladen für die Planart Grundriss"
            caption="Upload-Feld einer Planart: PDF oder Bild per Drag & Drop."
          />

          <Sub id="ergebnis" />
          <p>
            Nach der Prüfung öffnet sich das Ergebnis neben der Plan-Vorschau. Jeder Prüfpunkt nennt die Regel, den
            Befund mit Seitenangabe im Plan und eine Einschätzung der Sicherheit.
          </p>
          <div className={s.legend}>
            <div className={s.lBad}><b>Verstösse</b>Die Vorschrift ist laut Plan nicht eingehalten. Diese Punkte zuerst bearbeiten.</div>
            <div className={s.lWarn}><b>Unklare Punkte</b>Der Plan enthält nicht genug Angaben für ein eindeutiges Urteil. Fachlich prüfen oder Angaben ergänzen.</div>
            <div className={s.lOk}><b>Konforme Punkte</b>Die Vorschrift ist laut Plan eingehalten.</div>
          </div>
          <Fig
            src={imgErgebnis}
            alt="Ergebnisansicht mit Plan-Vorschau links und den Zählern 0 Verstösse, 6 unklare Punkte, 7 konforme Punkte rechts"
            caption="Ergebnis einer Grundriss-Prüfung: Plan-Vorschau links, Prüfpunkte rechts."
          />
          <div className={s.two}>
            <Fig
              src={imgPruefpunkt}
              narrow
              alt="Aufgeklappter Prüfpunkt Gebäudehöhe max. 8 m mit Begründung, Seite 8 und Konfidenz Mittel"
              caption="Ein Klick auf einen Prüfpunkt zeigt Begründung, Seite und Konfidenz."
            />
            <div>
              <ol className={s.steps}>
                <li><p>Filtern Sie mit <Ui>Verstösse</Ui>, <Ui>Warnungen</Ui> oder <Ui>Konform</Ui>.</p></li>
                <li><p>Exportieren Sie den Prüfbericht mit <Ui>Bericht (PDF)</Ui> oder die Liste mit <Ui>CSV</Ui>.</p></li>
                <li><p>Für eine überarbeitete Planversion klicken Sie auf <Ui>Neuer Plan</Ui>. Jede Prüfung bleibt als Version (V1, V2, …) links in der Liste erhalten.</p></li>
                <li><p>Offene Punkte aller Planarten sehen Sie gesammelt in der Übersicht des Reiters <Ui>Plan-Analyse</Ui>.</p></li>
              </ol>
            </div>
          </div>
          <Fig
            src={imgPlanAnalyse}
            alt="Übersicht Plan-Analyse mit offenen Punkten der Planart Grundriss"
            caption="Übersicht Plan-Analyse: offene Punkte aller Planarten auf einen Blick."
          />

          <div className={s.note}>
            <strong>Wichtig</strong>
            <p>
              TraceBuild unterstützt die Planprüfung, ersetzt aber nicht die Beurteilung durch eine Fachperson oder
              die Baubewilligungsbehörde. Unklare Punkte und Verstösse vor der Eingabe fachlich verifizieren.
            </p>
          </div>
          <div className={s.note}>
            <strong>Etwas funktioniert nicht wie beschrieben?</strong>
            <p>
              Melden Sie es uns über das{" "}
              <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer">
                Feedback-Formular
              </a>
              . Danke!
            </p>
          </div>
        </Chapter>

        <div className={s.more}>
          <div className={`${s.wrap} ${s.moreIntro}`}>
            <p className={s.eyebrow}>Weitere Themen</p>
            <p className={s.moreText}>
              Einrichtung Ihrer Organisation: eigene Normen hinterlegen und das Team verwalten. Das erledigt meist
              eine Person einmalig; für das Prüfen von Plänen ist es nicht nötig.
            </p>
          </div>

          <Chapter id="normen">
            <p className={s.chapterLead}>
              TraceBuild prüft Pläne gegen drei Quellen. Die ersten beiden sind bereits eingerichtet; Sie ergänzen nur,
              was für Ihre Projekte noch fehlt.
            </p>
            <ul className={s.sources}>
              <li>
                <span className={s.sourceTag}>Automatisch</span>
                <strong>ÖREB-Kataster</strong>
                <p>
                  In SG und AR lädt TraceBuild beim Anlegen eines Projekts den ÖREB-Auszug der Parzelle und ermittelt
                  die Bauzone, z.&nbsp;B. <Ui>W2</Ui>.
                </p>
              </li>
              <li>
                <span className={s.sourceTag}>Für alle Organisationen</span>
                <strong>Von TraceBuild hinterlegt</strong>
                <p>
                  Kantonale Gesetze und kommunale Baureglemente, z.&nbsp;B. Planungs- und Baugesetz SG mit Verordnung,
                  Baureglemente Mels und Sargans.
                </p>
              </li>
              <li>
                <span className={`${s.sourceTag} ${s.sourceTagOwn}`}>Nur Ihre Organisation</span>
                <strong>Eigene Normen</strong>
                <p>Weitere Reglemente oder interne Richtlinien, die Sie selbst in die Normen-Datenbank laden.</p>
              </li>
            </ul>

            <Sub id="norm-hochladen" />
            <p>
              Für kommunale Baureglemente, kantonale Gesetze oder interne Richtlinien laden Sie das Dokument einmal
              hoch. Es steht danach allen Projekten Ihrer Organisation zur Verfügung.
            </p>
            <ol className={s.steps}>
              <li><p>Klicken Sie in der linken Navigation auf <Ui>Normen-DB</Ui> und öffnen Sie <Ui>Norm hochladen</Ui>.</p></li>
              <li><p>Ziehen Sie die Datei in das Feld oder klicken Sie hinein. Erlaubt sind PDF- und Textdateien.</p></li>
              <li><p>Ordnen Sie die Norm mit den Feldern in der Tabelle unten ein.</p></li>
              <li><p>Klicken Sie auf <Ui>Hochladen &amp; speichern</Ui>. Die Norm erscheint rechts in der Liste.</p></li>
            </ol>
            <div className={`${s.tableWrap} ${s.fieldTable}`}>
              <table>
                <thead>
                  <tr>
                    <th>Feld</th>
                    <th>Was eintragen</th>
                    <th>Beispiel</th>
                  </tr>
                </thead>
                <tbody>
                  {NORM_FIELDS.map((f) => (
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
            <Fig
              src={imgNormHochladen}
              alt="Normen-Datenbank mit ausgefülltem Formular Norm hochladen: Ebene Gemeinde, Gemeinde Mels, Kategorie Grenzabstand, Zone W2"
              caption="Beispiel: kommunale Norm zum Grenzabstand in der Zone W2 der Gemeinde Mels."
            />

            <Sub id="projekt-normen" />
            <p>
              Im Projekt zeigt der Reiter <Ui>Normen</Ui>, welche Vorschriften für diese Parzelle gelten: zuerst die
              Themen aus dem ÖREB-Auszug, danach die passenden Normen aus Ihrer Datenbank.
            </p>
            <ol className={s.steps}>
              <li><p>Öffnen Sie das Projekt und wechseln Sie zum Reiter <Ui>Normen</Ui>.</p></li>
              <li><p>Ein Hinweis <Ui>Keine Norm in der Bibliothek für dieses Thema</Ui> zeigt eine Lücke. Laden Sie die fehlende Norm wie oben beschrieben hoch.</p></li>
              <li><p>Mit <Ui>Spezialnorm hinzufügen</Ui> ergänzen Sie eine Vorschrift nur für dieses Projekt, z.&nbsp;B. einen Sondernutzungsplan.</p></li>
              <li><p>Nach neuen Uploads aktualisieren Sie die Zuordnung mit <Ui>Normen neu laden</Ui>.</p></li>
            </ol>
            <Fig
              src={imgProjektNormen}
              alt="Reiter Normen eines Projekts mit ÖREB-Auszug, Zone W2 und parzellenspezifischen Themen"
              caption="Reiter Normen: ÖREB-Auszug der Parzelle, ermittelte Zone und offene Lücken."
            />
          </Chapter>

          <Chapter id="benutzer">
            <p className={s.chapterLead}>
              Neue Personen kommen per Einladung in Ihre Organisation. Einladen und Rechte vergeben kann nur, wer die
              Rolle Org Admin hat.
            </p>

            <Sub id="rollen" />
            <div className={s.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Rolle</th>
                    <th>Projekte bearbeiten, Pläne prüfen, Normen hochladen</th>
                    <th>Personen einladen und Rollen ändern</th>
                    <th>Projektmitglieder zuweisen, Projekte löschen</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Org Admin</td>
                    <td className={s.yes}>Ja</td>
                    <td className={s.yes}>Ja</td>
                    <td className={s.yes}>Ja</td>
                  </tr>
                  <tr>
                    <td>Projektleiter</td>
                    <td className={s.yes}>Ja</td>
                    <td className={s.no}>Nein</td>
                    <td className={s.no}>Nein</td>
                  </tr>
                  <tr>
                    <td>Mitglied</td>
                    <td className={s.yes}>Ja</td>
                    <td className={s.no}>Nein</td>
                    <td className={s.no}>Nein</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={s.note}>
              <strong>Gut zu wissen</strong>
              <p>
                Alle Personen einer Organisation sehen alle Projekte dieser Organisation. Projektleiter und Mitglied
                haben heute dieselben Rechte; die Rolle zeigt im Team, wer für ein Projekt verantwortlich ist.
              </p>
            </div>

            <Sub id="einladen" />
            <ol className={s.steps}>
              <li><p>Klicken Sie in der linken Navigation auf <Ui>Organisation</Ui>.</p></li>
              <li><p>Wechseln Sie zum Reiter <Ui>Mitglieder</Ui> und klicken Sie auf <Ui>+ Einladen</Ui>.</p></li>
              <li><p>Füllen Sie <Ui>Name</Ui> und <Ui>E-Mail</Ui> aus und wählen Sie die <Ui>Rolle</Ui>. Bestätigen Sie mit <Ui>Einladen</Ui>.</p></li>
              <li><p>Die Person erhält eine E-Mail, legt über den Link ihr Passwort fest und ist danach Teil Ihrer Organisation.</p></li>
            </ol>
            <div className={s.two}>
              <Fig
                src={imgMitglieder}
                alt="Reiter Mitglieder mit der Liste der Organisationsmitglieder und dem Button Einladen"
                caption="Organisation → Mitglieder: Liste aller Personen mit ihrer Rolle."
              />
              <Fig
                src={imgEinladen}
                alt="Dialog Mitglied einladen mit den Feldern Name, E-Mail und Rolle"
                caption="Dialog „Mitglied einladen“ mit Name, E-Mail und Rolle."
              />
            </div>

            <Sub id="rolle-aendern" />
            <ol className={s.steps}>
              <li><p>Öffnen Sie <Ui>Organisation</Ui> → <Ui>Mitglieder</Ui>.</p></li>
              <li><p>Wählen Sie in der Spalte <Ui>Rolle</Ui> die neue Rolle aus. Die Änderung gilt sofort.</p></li>
              <li><p>Um eine Person zu entfernen, klicken Sie am Zeilenende auf das Papierkorb-Symbol und bestätigen die Rückfrage.</p></li>
            </ol>

            <Sub id="projekt-zuweisen" />
            <ol className={s.steps}>
              <li><p>Öffnen Sie <Ui>Organisation</Ui> → <Ui>Projekte</Ui>.</p></li>
              <li><p>Klicken Sie in der Zeile des Projekts auf <Ui>Mitglieder</Ui>.</p></li>
              <li><p>Wählen Sie unter <Ui>Mitglied hinzufügen…</Ui> eine Person und klicken Sie auf <Ui>+</Ui>.</p></li>
            </ol>
            <Fig
              src={imgProjektmitglieder}
              alt="Seitenleiste Mitglieder eines Projekts mit Auswahlfeld Mitglied hinzufügen"
              caption="Projektmitglieder werden in einer Seitenleiste verwaltet."
            />
          </Chapter>
        </div>
      </main>

      <footer className={s.footer}>
        <div className={`${s.wrap} ${s.footerInner}`}>
          <span>TraceBuild · Handbuch für Organisationen</span>
          <span>Screenshots mit Beispieldaten (Musterbau AG)</span>
        </div>
      </footer>
    </div>
  );
}
