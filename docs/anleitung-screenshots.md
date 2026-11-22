# Anleitung: Screenshots

Stand 19. November 2026. Gilt für `frontend/app/anleitung/img/`.

Alle Bilder stammen vom 30. Oktober bzw. 2. November 2026 und zeigen das frühere dunkle Navy-Design. Seit dem
9. November ist die App hell (Creme/Weiss, schwarze Knöpfe, Fotoband). Deshalb ist **jedes Bild veraltet**. Neue
Aufnahmen gibt es nur echt aus der App, nie nachgebaut.

In der Anleitung tragen alte Bilder den Vermerk «Frühere Ansicht». Zwei irreführende Bilder sind durch eine
Feldtabelle ersetzt.

## Aufnahmeregeln

- Organisation «Musterbau AG» mit Beispieldaten, keine echten Kunden, Namen oder E-Mail-Adressen.
- Browserfenster 1280 × 800 (für Ausschnitte 960 breit), Zoom 100 %, ohne Lesezeichenleiste.
- Kein Mauszeiger im Bild, keine Admin-Banner (nicht als Super Admin aufnehmen, sondern als Org Admin der
  Musterbau AG).
- JPG, Qualität ca. 80; Prüfpunkt als PNG. Dateiname bleibt gleich, dann ist kein Code-Wechsel nötig.
- Nach dem Ersetzen in `page.tsx` beim Bild das Attribut `frueher` entfernen; bei den zwei entfernten Bildern
  `Fig` wieder einfügen.

## Pro Bild

| Datei | Stimmt noch? | Entscheid | Neu aufnehmen |
|---|---|---|---|
| `projekte.jpg` | Nein. Altes Design, Navigation «Normen-DB» statt «Unternehmensnormen», ohne Kennzahlen, ohne Kachel/Liste-Schalter. Ablauf («Projekte» → «+ Neues Projekt») stimmt. | Bleibt mit Vermerk. | `/dashboard/projects`, Kachelansicht, 4 Projekte, mindestens eines mit Projektnummer. Ganzes Fenster inkl. linker Navigation und Knopf «+ Neues Projekt». |
| `projekt-erstellen.jpg` | Nein, irreführend. Ohne Feld «Adresse oder Parzelle suchen», ohne «Projektnummer», Bauzone als Infotext statt Feld, keine Auswahl FL. | **Aus der Anleitung entfernt und gelöscht**, ersetzt durch Feldtabelle (Abschnitt 1.1). | `/dashboard/projects` → «+ Neues Projekt». Suche «Herisau 859» ausgeführt und Treffer übernommen (grüne Zeile «Übernommen: …»), Projektname «Neubau Wohnhaus Herisau», Projektnummer «2026-014». Ausschnitt: nur der Dialog. |
| `upload.jpg` | Nein. Altes Design, Reiter ohne «Normenblatt», Rücklink «← Dashboard» statt «Projekte». Upload-Feld und Text stimmen. | Bleibt mit Vermerk. | Projekt → «Plan-Analyse» → Prüfung «Baugesuch» → «Neue Version», kein Plan gewählt. Ausschnitt: Reiterleiste bis Upload-Feld, links die Versionsliste. |
| `ergebnis.jpg` | Nein. Altes Design, Reiter ohne «Normenblatt». Aufbau (Vorschau links, Zähler und Filter rechts, «Bericht (PDF)», «CSV», «Neue Version») stimmt. | Bleibt mit Vermerk. | Abgeschlossene Version V1 einer Prüfung «Baugesuch» mit Verstössen, unklaren und konformen Punkten. Ganzes Fenster. |
| `pruefpunkt.png` | Inhalt stimmt (Begründung, Kategorie, «Konfidenz: Mittel», «S. 8»), Farben alt. | Bleibt mit Vermerk. | Gleiche Analyse, ein konformer Prüfpunkt aufgeklappt, darüber und darunter je zwei zugeklappte. Ausschnitt ca. 700 breit. |
| `plan-analyse.jpg` | Nein. Altes Design, ohne Abschnitt «Grundstück» und ohne Projekt-Banner. «Offene Punkte» mit Filtern stimmt. | Bleibt mit Vermerk. | Projekt → «Plan-Analyse» (Übersicht, keine Prüfung offen) mit Abschnitt «Grundstück» (Zone «aus ÖREB») und «Offene Punkte». Ganzes Fenster. |
| `norm-hochladen.jpg` | Nein, irreführend. Alte Seite «Normen-Datenbank» mit «Norm hochladen», ohne die Reiter «Unternehmensnormen / Eigene Fassungen / Gesetzliche Grundlagen», ohne Verbindlichkeit und Geltungsbereich. | **Aus der Anleitung entfernt und gelöscht**, ersetzt durch zwei Feldtabellen (Abschnitte 5.2 und 5.3). | Zwei Bilder: (a) `/standards`, Reiter «Unternehmensnormen», «Unternehmensnorm hochladen» geöffnet, Kategorie «Brandschutz», Verbindlichkeit «Verbindlich», Gilt für «Alle Projekte». (b) Reiter «Eigene Fassungen», «Eigene Fassung hochladen», Ebene «Gemeinde», Kanton SG, Gemeinde «Mels», Kategorie «Grenzabstand», Zone «W2». Neue Dateien `unternehmensnorm-hochladen.jpg` und `eigene-fassung.jpg`. |
| `projekt-normen.jpg` | Nein. Altes Design. Aufbau (Grundstück, ÖREB-Zeile, «Parzellenspezifisch (ÖREB)», Hinweis «Keine Norm in der Bibliothek für dieses Thema.») stimmt; Abschnitt «Reglemente aus dem ÖREB-Kataster» fehlt. | Bleibt mit Vermerk. | Projekt in SG → «Normen», mindestens eine Lücke. Ausschnitt: Banner bis erste Themengruppe. |
| `mitglieder.jpg` | Nein. Altes Design. Reiter, Spalten und «Einladen» stimmen. | Bleibt mit Vermerk. | `/admin/org` → Reiter «Mitglieder (n)», zwei bis drei Personen. Ganzes Fenster. |
| `einladen.jpg` | Nein. Altes Design. Felder Name, E-Mail, Rolle und Knöpfe stimmen. | Bleibt mit Vermerk. | `/admin/org` → «Mitglieder» → «Einladen», Name «Laura Beispiel», E-Mail `laura.beispiel@musterbau.ch`, Rolle «Projektleiter». Nicht absenden. |
| `projektmitglieder.jpg` | Nein. Altes Design. Seitenleiste «Mitglieder» mit «Mitglied hinzufügen…» und «+» stimmt. | Bleibt mit Vermerk. | `/admin/org` → «Projekte» → Zeile «Obergasse» → «Mitglieder». Ganzes Fenster. |
| `logo.png` | Altes Logo, wird nirgends verwendet. | Gelöscht. | Keine Aufnahme nötig. |

## Fehlende Bilder (Wunsch)

Für neue Abschnitte gibt es noch keine Bilder. Wenn Zeit ist:

- 1.2 Grundstück: Abschnitt «Grundstück» mit Hinweis «Bauzone unsicher, bitte prüfen» und Feld «Vorschlag bestätigen».
- 1.5 Änderungsprüfung: Dateiliste mit den Knöpfen «Änderungsprüfung» und «Vollprüfung»; Ergebnis mit Zusammenfassung «Änderungsprüfung gegenüber Version 1» und Marken «Behoben»/«Neu».
- 1.6 Fehlgeschlagene Analyse: Version mit Marke «Fehler», Meldung mit «Grund», «Referenz für den Support» und «Erneut versuchen».
- 3.1 Normenblatt: ausgefülltes Blatt mit Kenndaten.
- 3.2 KI Chat: Verlauf links, eine Frage mit Antwort.
