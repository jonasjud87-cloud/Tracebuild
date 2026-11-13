# Normabgleich: Prüfliste nach dem Deployment

Für Admins von Tracebuild. Alles in der Weboberfläche prüfbar, ohne Code.

## Vorher erledigt

- [ ] Migration `20261113000001_norm_watch.sql` in Supabase eingespielt
- [ ] `CRON_SECRET` in Vercel angelegt (Production)
- [ ] Code auf Produktion deployt (Vercel zeigt das neue Deployment als «Ready»)

## 0. Zuordnung der Quellen in Supabase prüfen (vor dem ersten Abgleich)

Die Migration hat die Quellen anhand des Titels einer bestehenden Norm zugeordnet. Das kann danebengreifen. Im SQL-Editor ausführen und die Spalte `title` mit der Quelle vergleichen:

```sql
select s.label, n.title as zugeordnete_norm, n.created_at
from norm_sources s
left join norms n on n.id = s.norm_id
order by s.label;
```

Stimmt eine Zeile nicht (falsche oder fehlende Norm), im Bereich «Normabgleich» die richtige Norm auswählen und auf «Zuordnen» klicken. Der erste Abgleich würde sonst den Text der falschen Norm ersetzen.

## 1. Vercel

1. Projekt öffnen, **Settings → Cron Jobs**.
2. Es steht ein Eintrag `/api/v1/internal/norm-watch` mit Plan `0 5 * * 1` (montags 05:00 UTC, in der Schweiz 06:00 oder 07:00 Uhr).
3. Falls die Seite eine Begrenzung des Plans meldet, den Text festhalten.
4. Den Job einmal von Hand ausführen (Schaltfläche «Run» o. ä.). Erwartet: Status 200. Bei 401 stimmt `CRON_SECRET` nicht oder das Deployment ist älter als die Variable (neu deployen).
5. Unter **Logs** (Filter auf diese Route) steht keine Fehlermeldung.

## 2. Admin-Übersicht (`/admin`)

1. Ganz unten erscheint die Karte **Normen-Aktualität**.
2. Sie zeigt 5 Quellen. Vor dem ersten Abgleich stehen die Quellen auf «Ungeprüft» oder «Fehlt».
3. Nach «Aktualisieren» oben rechts lädt die Karte neu, ohne Fehlermeldung.

## 3. Normen-Seite (`/admin/norms`)

1. Oben der Bereich **Normabgleich** mit den 5 Quellen:
   USG (SR 814.01), LSV (SR 814.41), PBG (sGS 731.1), PBV (sGS 731.11), EG-USG-Verordnung (sGS 672.11).
2. Unter jeder Quelle steht die zugeordnete Norm. Bei «Fehlt» fehlt die Zuordnung: im Auswahlfeld die passende Norm wählen und auf «Zuordnen» klicken.
3. Auf **Jetzt prüfen** klicken. Erwartet: Meldung wie «5 Quellen geprüft, 5 neue Entwürfe». Beim ersten Mal ist ein Entwurf pro Quelle normal, weil der gespeicherte Text aus einem PDF stammt und der neue aus dem amtlichen Text.
4. Bei einem Entwurf auf **Entwurf prüfen** klicken:
   - Alter und neuer Stand stehen oben («Stand 1. April 2026 → Stand 1. August 2026»).
   - Zeichenzahlen und Übereinstimmung in Prozent sind plausibel.
   - Beispiele «Neu in der Fassung» und «Nur im bisherigen Text» sind lesbar und sinnvoll (Kopfzeilen und Fussnoten als Unterschied sind beim ersten Mal in Ordnung).
   - Erscheint ein gelbes Feld «Der neue Text ist deutlich kürzer …» oder «stimmt nur zu weniger als der Hälfte überein», den Entwurf nicht blind freigeben: Text des PDFs und der Quelle vergleichen.
5. Einen Entwurf **freigeben** (zuerst eine unkritische Norm wie die EG-USG-Verordnung). Erwartet:
   - Meldung «Neue Fassung übernommen».
   - Quelle steht auf «Aktuell», «Stand» zeigt die neue Fassung.
   - Unter **Ankündigungen** liegt ein neuer Entwurf «Rechtsgrundlage aktualisiert: …», **nicht aktiv**.
   - In der Normen-Liste hat die Norm den neuen Text (Titel mit neuem Stand-Datum, falls der Titel nach dem Schema «Bezeichnung, Stand …» aufgebaut war).
6. Auf **Jetzt prüfen** erneut klicken. Erwartet: keine neuen Entwürfe für die freigegebene Quelle.
7. Einen Entwurf **ablehnen** testen. Erwartet: Er verschwindet und kommt beim nächsten Prüfen nicht wieder.
8. **Quelle hinzufügen**: Bundesnormen, die noch fehlen (Vorschlag, bitte bestätigen):
   - Gewässerschutzgesetz, SR 814.20
   - Raumplanungsgesetz, SR 700
   - Natur- und Heimatschutzgesetz, SR 451
   Danach «Jetzt prüfen».

## 4. Glocke

1. Bei offenen Entwürfen zeigt die Glocke oben rechts eine Zahl.
2. Die Einträge heissen «Neue Fassung zur Freigabe» und führen zu `/admin/norms#norm-watch`.
3. Nach Freigabe oder Ablehnen aller Entwürfe verschwinden diese Einträge (kann bis zu 2 Minuten dauern).

## 5. Inhalt prüfen (Stichproben)

1. Eine Analyse mit einem Projekt starten. Im Bericht erscheinen die Normen mit ihrem Stand.
2. In der Normen-Liste die Länge des PBG ansehen: Der amtliche Text hat rund 104'000 Zeichen. Wenn der bisherige Text genau 100'000 Zeichen lang war, fehlten vermutlich die letzten Artikel.
3. Beim USG liegt der amtliche Text bei rund 105'000 Zeichen. Ist der gespeicherte Text deutlich länger, enthielt er vermutlich Kopf- und Fusszeilen.

## 5b. Normenblatt nach einer Freigabe

1. Ein Projekt öffnen, dessen Normenblatt Kennwerte aus der freigegebenen Norm zeigt.
2. Erwartet: Die Kennwerte werden neu berechnet (nicht mehr «aus dem Cache»), weil sich der Text-Stand der Norm geändert hat.

## 6. Nach der ersten Woche

1. Dienstag nach dem ersten Montag: Im Bereich «Normabgleich» steht «Letzter Abgleich» mit dem Datum vom Montag.
2. Die Glocke zeigt keine Meldung «Normabgleich überfällig».
3. Bei Fehlern steht in der Zeile der Quelle der Grund (zum Beispiel «Fedlex antwortet mit 503»). Einzelne Fehler sind bei kurzen Ausfällen normal, beim nächsten Lauf verschwinden sie.

## Wenn etwas nicht stimmt

- Karte oder Bereich zeigen «Der Normabgleich ist noch nicht eingerichtet»: Die Migration fehlt auf dieser Datenbank.
- Cron meldet 401: `CRON_SECRET` fehlt oder gilt nur für ältere Deployments.
- Eine Quelle bleibt auf «Fehler»: Fehlertext in der Zeile lesen, Nummer der Quelle prüfen (SR bzw. sGS).
- Zurückdrehen: Die Funktion lässt sich ausschalten, indem die Quellen im Panel pausiert werden. Der alte Normtext ist pro Freigabe in `norm_text_versions` gespeichert.
