# Anleitung: Screenshots

Stand 22. November 2026. Gilt für `frontend/app/anleitung/img/`.

Alle 9 Bilder der Anleitung sind am 22. November 2026 neu aufgenommen worden, echt aus der Produktions-App im hellen
Design (seit 9. November). Der Vermerk «Frühere Ansicht» ist entfernt. Neue Aufnahmen gibt es nur echt aus der App,
nie nachgebaut.

Offen sind die zwei entfernten Bilder (durch Feldtabellen ersetzt) und die Wunschbilder unten.

## Aufnahmeregeln

- Produktion, Organisation «TraceBuild», angemeldet als Super Admin. Vor der Aufnahme ausblenden: Admin-Leiste,
  Ankündigungsbanner, die eigene E-Mail-Adresse sowie eigener Name und Avatar in der Navigation.
- Namen und E-Mail-Adressen von Mitgliedern durch Beispieldaten ersetzen (z. B. «Laura Beispiel»,
  `laura.beispiel@musterbau.ch`). Keine echten Personen im Bild.
- Unkenntlich machen (blurren): Plankopf mit Bauherrschaft und Planverfasser in Plan-Vorschauen, Parzellennummer,
  EGRID und Plan-Dateinamen.
- Browserfenster 1280 × 800 (für Ausschnitte schmaler), Zoom 100 %, ohne Lesezeichenleiste, kein Mauszeiger im Bild.
- JPG, Qualität ca. 80; Prüfpunkt als PNG. Dateiname bleibt gleich, dann ist kein Code-Wechsel nötig.
- Alt-Text und Bildunterschrift in `page.tsx` an den Bildinhalt anpassen (Namen, Zahlen, sichtbare Elemente). Bei den
  zwei entfernten Bildern `Fig` wieder einfügen.

## Pro Bild

| Datei | Stand | Inhalt | Platz in der Anleitung |
|---|---|---|---|
| `projekte.jpg` | Aktuell, 22.11.2026, Produktion. Eigener Name und Avatar unten links geblurrt. | `/dashboard/projects`, Kachelansicht, «5 Projekte», Suche, «+ Neues Projekt», Kennzahlen, linke Navigation. Projektkarten nur angeschnitten. | 1.1 Projekt anlegen |
| `projekt-erstellen.jpg` | **Offen.** Aus der Anleitung entfernt und gelöscht, ersetzt durch Feldtabelle (Abschnitt 1.1). | Wunsch: `/dashboard/projects` → «+ Neues Projekt». Suche «Herisau 859» ausgeführt und Treffer übernommen (grüne Zeile «Übernommen: …»), Projektname «Neubau Wohnhaus Herisau», Projektnummer «2026-014». Ausschnitt: nur der Dialog. | – |
| `plan-analyse.jpg` | Aktuell, 22.11.2026, Produktion. Parzellennummer und EGRID geblurrt. | Projekt «Obergasse», Reiter «Plan-Analyse»: Abschnitt «Grundstück» (Parzelle und EGRID unkenntlich, «Zone W2 · aus ÖREB-Auszug», «Neu laden», «Zusatzdaten und Links»), Beginn «Offene Punkte» mit Filtern. | 1.2 Grundstück und Bauzone (vorher bei 1.4 Ergebnis) |
| `upload.jpg` | Aktuell, 22.11.2026, Produktion. | Prüfung «Grundriss» → «Neue Version»: links Versionsliste, rechts Upload-Feld «Pläne hochladen». | 1.3 Pläne hochladen; Bildunterschrift nennt die neue Version. |
| `ergebnis.jpg` | Aktuell, 22.11.2026, Produktion. Plankopf mit Bauherrschaft geblurrt. | Prüfung «Grundriss», V4: Versionen links, Plan-Vorschau, «Bericht (PDF)», «CSV», «Neue Version», ÖREB-Stand, Zähler 1 / 15 / 22, Filter, erster Prüfpunkt. | 1.4 Ergebnis |
| `pruefpunkt.png` | Aktuell, 22.11.2026, Produktion. Ausschnitt ca. 460 breit. Quellenzeile geblurrt. | Aufgeklappt «Art. 12 BauR Mels – Kleiner Grenzabstand (4.0 m)» mit Begründung, «Grenzabstand», «Konfidenz: Mittel», Quellenzeile (Datei und Seite) unkenntlich; darüber und darunter zugeklappte Punkte. | 1.4 Ergebnis |
| `norm-hochladen.jpg` | **Offen.** Aus der Anleitung entfernt und gelöscht, ersetzt durch zwei Feldtabellen (Abschnitte 5.2 und 5.3). | Wunsch, zwei Bilder: (a) `/standards`, Reiter «Unternehmensnormen», «Unternehmensnorm hochladen» geöffnet, Kategorie «Brandschutz», Verbindlichkeit «Verbindlich», Gilt für «Alle Projekte». (b) Reiter «Eigene Fassungen», «Eigene Fassung hochladen», Ebene «Gemeinde», Kanton SG, Gemeinde «Mels», Kategorie «Grenzabstand», Zone «W2». Neue Dateien `unternehmensnorm-hochladen.jpg` und `eigene-fassung.jpg`. | – |
| `projekt-normen.jpg` | Aktuell, 22.11.2026, Produktion. Parzellennummer und EGRID geblurrt. | Reiter «Normen»: «9 Normen zugewiesen», Karte «Mels, Kanton SG» mit Zone (Parzelle und EGRID unkenntlich), ÖREB-Zeile mit «Amtlicher PDF-Auszug», Abschnitt «Reglemente aus dem ÖREB-Kataster», Beginn Gruppe «Bund». | 2.1 Reiter Normen lesen |
| `mitglieder.jpg` | Aktuell, 22.11.2026, Produktion. Namen und E-Mails sind Beispieldaten. | `/admin/org`, Reiter «Mitglieder (3)», «+ Einladen», Tabelle mit Rolle und Papierkorb. | 6.2 Eine Person einladen |
| `einladen.jpg` | Aktuell, 22.11.2026, Produktion. Beispieldaten. | Dialog «Mitglied einladen», «Laura Beispiel», `laura.beispiel@musterbau.ch`, Rolle «Projektleiter». Nicht abgesendet. | 6.2 Eine Person einladen |
| `projektmitglieder.jpg` | Aktuell, 22.11.2026, Produktion. | `/admin/org`, Reiter «Projekte», Seitenleiste «Mitglieder · Obergasse» mit «Mitglied hinzufügen…» und «+». | 6.4 Personen einem Projekt zuweisen |
| `logo.png` | Altes Logo, wird nirgends verwendet. Gelöscht. | – | – |

## Fehlende Bilder (Wunsch)

Für folgende Abschnitte gibt es noch keine Bilder. Wenn Zeit ist:

- 1.2 Grundstück: Hinweis «Bauzone unsicher, bitte prüfen» mit «Vorschlag bestätigen» (das aktuelle Bild zeigt eine
  sichere Zone).
- 1.5 Änderungsprüfung: Dateiliste mit den Knöpfen «Änderungsprüfung» und «Vollprüfung»; Ergebnis mit Zusammenfassung «Änderungsprüfung gegenüber Version 1» und Marken «Behoben»/«Neu».
- 1.6 Fehlgeschlagene Analyse: Version mit Marke «Fehler», Meldung mit «Grund», «Referenz für den Support» und «Erneut versuchen».
- 3.1 Normenblatt: ausgefülltes Blatt mit Kenndaten.
- 3.2 KI Chat: Verlauf links, eine Frage mit Antwort.
