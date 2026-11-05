# Geoportal-Anbindung: Einschränkungen und offene Punkte

Stand 5.11.2026. Erledigtes abhaken oder löschen.

## Entscheide

- `pg_net` und `pg_cron` werden aktiviert, sobald der Spike bestanden ist.
- Kostengrenze USD 15 pro Analyse (`ANALYSIS_MAX_COST_USD`), dazu höchstens 30 importierte Teile.
- Vercel bleibt vorerst auf Hobby. Pro ist geplant, spätestens vor dem kommerziellen Betrieb.
- Jedes Org-Mitglied darf eine eigene Fassung als massgebend festlegen.
- Das Lesen von Scans durch Claude ist beschlossen, aber aus, bis die Kosten gemessen sind.

## Rollout

- [x] Migrationen 20261107 und 20261109 eingespielt
- [ ] Branch `feature/analysis-stages` in `main` gemergt
- [ ] Spike auf Vercel (`supabase/ops/analysis-stages-activate.sql`)
- [ ] Migration 20261108 einspielen, erst dann gelten die Rechte-Sperren für Analysen, Dokumente, Prüfpunkte und Norm-Verknüpfungen
- [ ] `pg_net` und `pg_cron` aktivieren, Aktivierungsskript ausführen
- [ ] Negativtest `supabase/ops/geoportal-negative-test.mjs`; um die Sperren aus 07 bis 09 ergänzen
- [ ] St. Gallen freigeben, Quarten testen, danach Kanton für Kanton
- [ ] Spike-Route, `spike.ts`, Skript und Middleware-Ausnahme entfernen

## Echter Betrieb: noch nie real gelaufen

| Bereich | Einschränkung | Zu tun |
|---|---|---|
| Datenbank | Migrationen, Sperren, Trigger und RPC liefen nur gegen Attrappen und PGlite | Negativtest, danach Testprojekt |
| Parallele Importe | Sperre je Gemeinde nur simuliert | Zwei Browser, gleiche Gemeinde |
| Grosse PDFs | Speicher und Zeit auf Vercel nicht gemessen | Grosses Reglement importieren, Logs ansehen |
| Etappen | `waitUntil`, Kette und `pg_net` nur mit Fakes | Spike, dann Abnahmen A1 bis A10 aus der Spezifikation |
| Prompt-Cache | Treffer über Etappen ungeprüft, wirkt auf die Kosten | Abnahme A4 messen |
| Oberfläche | Admin-Seite, Hinweise und Fortschritt nie im Browser gegen echte Routen | Manueller Durchgang |
| Kantonsdienste | Zonenregeln beruhen auf je einer Parzelle pro Kanton | Konformitätslauf nach Deploy, weitere Parzellen |

Überwachung in den ersten Tagen: `supabase/ops/geoportal-checks.sql`.

## Kantone

| Kanton | Einschränkung | Zu tun |
|---|---|---|
| NE | Auszug nur für gemeldete Nutzer, zeigt Status und PDF-Link | Vorerst ausgelassen; später SITN anfragen |
| FR | Dienst antwortete im Test mit HTTP 500 | Erneut prüfen |
| BS | Dienst instabil, Regelbauweise wohl kantonal | Beobachten, Kantonsrecht von Hand |
| GE | Regelbauweise wohl kantonal (LCI) | Kantonsrecht von Hand |
| JU | Delémont: 422'306 Zeichen, über dem Limit von 250'000 | Aufteilen oder Limit entscheiden |
| SO | Reglemente sind Scans | Scans lesen |
| TI | Dokument gilt nur für einen Ortsteil, wird aber Gemeindenorm; Zone teils falsch und nur Vorschlag | Regel ergänzen |
| ZH | Fussnoten verfälschen Artikelnummern («Art. 1337») | Textaufbereitung verbessern |
| FR, VS | Stand falsch erkannt; VS: Änderungen fehlen oder sind Scans | Prüfen |
| SG | «Kernzone Altstadt» erscheint als «Dorfkernzone»; Fachreview rät vorerst zu Parzellen ohne Sondernutzungsplan | Adapter prüfen, Fachperson beiziehen |
| Mehrfachtreffer | BE, BS, GL, LU, SH, TI, VS: Nutzer muss öfter wählen | Beobachten |

## Filter und Import

- Scans werden abgelehnt, solange das Lesen aus ist (z. B. Quarten, Reglement 2021). Kosten am Dokument messen: `frontend/scripts/oereb-ocr-cost.mjs`.
- Ortsteil-Erkennung ist nur an wenigen Titeln abgestimmt und prüft nur Neuimporte. Abweichende Schreibweisen landen in `review`.
- AI und TG bestehen nur über Absätze plus Erlassformel, GL und TG haben je einen Fall in `review`.
- Der Inhaltstest der Filter lief auf 63 PDFs, 384 Dokumente sind nicht alle geprüft.
- Mit `active=false` läuft der Versionsabgleich weiter und kann Normen wieder freigeben.
- Gleicher Titel, unähnlicher Text: Die manuelle Norm bleibt massgebend. Begleitbriefe ab Folge 10 bleiben drin und werden als Verdacht gezeigt.
- Ablösung alter Fassungen zwischen Auszügen erst nach 30 Tagen ohne Sichtung, bis dahin wird gegen beide geprüft.
- Kantons- und Bundesrecht wird nicht importiert, nur Gemeindedokumente.
- «Per KI gelesen» erscheint nur in den Dokumentenlisten, nicht auf den Normkarten.
- Mitglieder können eine unsichere Zone nach dem Anlegen nicht ändern, nur Admins.

## Normen-Datenbank

| Norm | Befund | Zu tun |
|---|---|---|
| `B_Umweltschutz.pdf` (global) | Bei 100'000 Zeichen mitten im Satz abgeschnitten, der Rest des Gesetzes fehlt | Neu hochladen und Zuweisungen prüfen |
| `SG_PlanungsundBaugesetz.pdf` | Bei 100'000 von 104'084 Zeichen abgeschnitten, es fehlt nur das Ende der Änderungstabelle | Optional neu hochladen |
| `SG_PBV.pdf` | Ohne Anhang: 12'921 statt 18'723 Zeichen, 9 statt 16 Seiten | Fassung mit Anhang hochladen |
| `Baureglement_05.02_29.05.2012.pdf` (Atelier Drü) | Veraltet (Neudruck 2008), wird nach der Freigabe abgelöst | Beim Quarten-Test prüfen |

## Später

- Kosten auf ein Minimum senken (Modellwahl, Cache, Batch API über Nacht, Vorauswahl der Normen).
- Handbuch aktualisieren: `projekt-erstellen.jpg`, wohl auch `projekt-normen.jpg` und `plan-analyse.jpg`.
- Normen-Upload hat weiterhin die 4.5-MB-Grenze von Vercel.
- Der Storage-Bucket `documents` ist öffentlich, auf zeitlich begrenzte Links umstellen.
- Recht klären: amtliche Texte global speichern, Nutzung von Vercel Hobby.
- `SUPABASE_SERVICE_KEY` erneuern (war in einer Tool-Ausgabe sichtbar).
- Arbeitskopien `wt-stages` und `wt-import-ui` nach dem Merge entfernen.
