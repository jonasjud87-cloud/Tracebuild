# Anleitung: Screenshots

Stand 23. November 2026. Gilt für `frontend/app/anleitung/img/`.

Alle 15 Bilder der Anleitung sind echt aus der Produktions-App im hellen Design (seit 9. November), aufgenommen am
22. und 23. November 2026. Neue Aufnahmen gibt es nur echt aus der App, nie nachgebaut.

Offen sind nur noch die zwei Wunschbilder unten.

## Aufnahmeregeln

- Produktion, Organisation «TraceBuild», angemeldet als Super Admin. Vor der Aufnahme ausblenden: Admin-Leiste,
  Ankündigungsbanner, die eigene E-Mail-Adresse sowie eigener Name und Avatar in der Navigation.
- Namen und E-Mail-Adressen von Mitgliedern durch Beispieldaten ersetzen (z. B. «Laura Beispiel»,
  `laura.beispiel@musterbau.ch`). Keine echten Personen im Bild.
- Unkenntlich machen (blurren): Projektnamen, Plankopf mit Bauherrschaft und Planverfasser in Plan-Vorschauen,
  Parzellennummer, EGRID und Plan-Dateinamen.
- Projektnamen unkenntlich machen, auch in Kopfzeilen, Seitenleisten und Tabellen im Hintergrund. Alt-Text und
  Bildunterschrift nennen keinen Projektnamen. Ausnahme: Beispielnamen in einem nicht gespeicherten Dialog.
- Browserfenster 1280 × 800 (für Ausschnitte schmaler), Zoom 100 %, ohne Lesezeichenleiste, kein Mauszeiger im Bild.
- JPG, Qualität ca. 80; Prüfpunkt als PNG. Dateiname bleibt gleich, dann ist kein Code-Wechsel nötig.
- Alt-Text und Bildunterschrift in `page.tsx` an den Bildinhalt anpassen (Namen, Zahlen, sichtbare Elemente).

## Pro Bild

| Datei | Stand | Inhalt | Platz in der Anleitung |
|---|---|---|---|
| `projekte.jpg` | Aktuell, 22.11.2026, Produktion. Eigener Name und Avatar unten links geblurrt. | `/dashboard/projects`, Kachelansicht, «5 Projekte», Suche, «+ Neues Projekt», Kennzahlen, linke Navigation. Projektkarten nur angeschnitten. | 1.1 Projekt anlegen |
| `projekt-erstellen.jpg` | Aktuell, 23.11.2026, Produktion. 443 × 517. Nicht gespeichert. | Dialog «Neues Analyseprojekt / Projekt erstellen»: Suche «Herisau 859», grüne Zeile «Übernommen: Parzelle 859, Herisau AR (…). Die Felder bleiben korrigierbar.», Projektname «Neubau Wohnhaus Herisau», Projektnummer «2026-014» mit Hinweis zur Eindeutigkeit. | 1.1 Projekt anlegen, nach der Feldtabelle |
| `plan-analyse.jpg` | Aktuell, 23.11.2026, Produktion. Projektname, Parzellennummer und EGRID geblurrt. | Reiter «Plan-Analyse»: Abschnitt «Grundstück» (Parzelle und EGRID unkenntlich, «Zone W2 · aus ÖREB-Auszug», «Neu laden», «Zusatzdaten und Links»), Beginn «Offene Punkte» mit Filtern. | 1.2 Grundstück und Bauzone |
| `upload.jpg` | Aktuell, 23.11.2026, Produktion. Projektname in der Kopfzeile geblurrt. | Prüfung «Grundriss» → «Neue Version»: links Versionsliste, rechts Upload-Feld «Pläne hochladen». | 1.3 Pläne hochladen; Bildunterschrift nennt die neue Version. |
| `ergebnis.jpg` | Aktuell, 22.11.2026, Produktion. Plankopf mit Bauherrschaft geblurrt. | Prüfung «Grundriss», V4: Versionen links, Plan-Vorschau, «Bericht (PDF)», «CSV», «Neue Version», ÖREB-Stand, Zähler 1 / 15 / 22, Filter, erster Prüfpunkt. | 1.4 Ergebnis |
| `pruefpunkt.png` | Aktuell, 22.11.2026, Produktion. Ausschnitt ca. 460 breit. Quellenzeile geblurrt. | Aufgeklappt «Art. 12 BauR Mels – Kleiner Grenzabstand (4.0 m)» mit Begründung, «Grenzabstand», «Konfidenz: Mittel», Quellenzeile (Datei und Seite) unkenntlich; darüber und darunter zugeklappte Punkte. | 1.4 Ergebnis |
| `aenderungspruefung.jpg` | Aktuell, 23.11.2026, Produktion. 455 × 519. Zwei Ausschnitte, getrennt durch drei Punkte. | Oben «Baugesuch · V2», «Samstag, 14. November 2026», «Bericht (PDF)», «CSV», «Neue Version», «ÖREB-Stand: 14.11.2026», Kasten «Änderungsprüfung gegenüber Version 1 – 26 unverändert, 1 neu», gelber Hinweis «Doppelte Prüfpunkte konnten nicht zusammengeführt werden…»; unten zwei Prüfpunkte, der letzte «Art. 69 PBG – Abstellplätze (Parkierung)» mit Marke «Neu». Marke «Behoben» nicht im Bild. | 1.5 Neue Version und Änderungsprüfung, nach der Markentabelle |
| `projekt-normen.jpg` | Aktuell, 22.11.2026, Produktion. Parzellennummer und EGRID geblurrt. | Reiter «Normen»: «9 Normen zugewiesen», Karte «Mels, Kanton SG» mit Zone (Parzelle und EGRID unkenntlich), ÖREB-Zeile mit «Amtlicher PDF-Auszug», Abschnitt «Reglemente aus dem ÖREB-Kataster», Beginn Gruppe «Bund». | 2.1 Reiter Normen lesen |
| `normenblatt.jpg` | Aktuell, 23.11.2026, Produktion. 895 × 591. Projektname, Parzelle und Wert der Landfläche geblurrt. | Normenblatt «Mels, Kanton SG», 14.11.2026, Tabelle «Kenndaten» (Bezeichnung / Wert / Quelle): Zone W2 und Landfläche (Wert unkenntlich, ÖREB-Auszug), Vollgeschosse 2, Ausnützungsziffer 0.50, Grenzabstand gross 8.00 m und klein 4.00 m, Gebäudelänge 24.00 m (je `Mels_Baureglement.pdf`, Art. 9). | 3.1 Normenblatt |
| `ki-chat.jpg` | Aktuell, 23.11.2026, Produktion. 1205 × 569. Projektname in der Antwort geblurrt. | Reiter «KI Chat»: links «Verlauf» mit zwei Gesprächen, Hinweis «Dieser Chat ersetzt keine Rechtsberatung…», Frage «Was ist der Grenzabstand in dieser Bauzone?», Antwort zur Bauzone W2 mit Tabelle kleiner 4.0 m / grosser 8.0 m, unten Eingabefeld «Frage stellen…». | 3.2 KI Chat |
| `unternehmensnorm-hochladen.jpg` | Aktuell, 23.11.2026, Produktion. 1205 × 500. Keine Datei gewählt, nicht gespeichert. | `/standards`, Formular «Unternehmensnorm hochladen»: Ablagefeld «PDF / TXT», Kategorie «Brandschutz», Bezeichnung «Brandschutzrichtlinie 2026», Zone leer, Verbindlichkeit «Verbindlich» mit Hinweis, Gilt für «Alle Projekte», Knopf «Hochladen & speichern» inaktiv. Ersetzt zusammen mit `eigene-fassung.jpg` das frühere `norm-hochladen.jpg`. | 5.2 Unternehmensnorm hochladen, nach der Feldtabelle |
| `eigene-fassung.jpg` | Aktuell, 23.11.2026, Produktion. 1205 × 420. Nicht gespeichert. | `/standards`, Reiter «Eigene Fassungen», Formular «Eigene Fassung hochladen»: Ebene «Gemeinde», Gemeinde «Mels», Kategorie «Grenzabstand», Quelle «Baureglement Mels», Zone «W2», Knopf «Hochladen & speichern». Bei Ebene «Gemeinde» gibt es kein Kantonsfeld. | 5.3 Eigene Fassung hochladen, nach der Feldtabelle |
| `mitglieder.jpg` | Aktuell, 22.11.2026, Produktion. Namen und E-Mails sind Beispieldaten. | `/admin/org`, Reiter «Mitglieder (3)», «+ Einladen», Tabelle mit Rolle und Papierkorb. | 6.2 Eine Person einladen |
| `einladen.jpg` | Aktuell, 22.11.2026, Produktion. Beispieldaten. | Dialog «Mitglied einladen», «Laura Beispiel», `laura.beispiel@musterbau.ch`, Rolle «Projektleiter». Nicht abgesendet. | 6.2 Eine Person einladen |
| `projektmitglieder.jpg` | Aktuell, 23.11.2026, Produktion. Projektname in der Seitenleiste und Projektnamen der Tabelle im Hintergrund geblurrt. | `/admin/org`, Reiter «Projekte», Seitenleiste «Mitglieder · …» mit «Mitglied hinzufügen…» und «+». | 6.4 Personen einem Projekt zuweisen |
| `norm-hochladen.jpg` | Gelöscht. Ersetzt durch `unternehmensnorm-hochladen.jpg` und `eigene-fassung.jpg`. | – | – |
| `logo.png` | Altes Logo, wird nirgends verwendet. Gelöscht. | – | – |

## Fehlende Bilder (Wunsch)

Offen sind nur noch zwei Bilder. In der Organisation «TraceBuild» gibt es dafür derzeit keine passenden Daten (keine
unsichere Bauzone, keine fehlgeschlagene Analyse). Kundendaten werden nicht verwendet.

- 1.2 Grundstück: Hinweis «Bauzone unsicher, bitte prüfen» mit «Vorschlag bestätigen» (das aktuelle Bild zeigt eine
  sichere Zone).
- 1.6 Fehlgeschlagene Analyse: Version mit Marke «Fehler», Meldung mit Grund, Referenz für den Support und «Erneut
  versuchen».
