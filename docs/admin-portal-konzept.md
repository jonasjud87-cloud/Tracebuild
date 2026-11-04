# Admin-Portal: Ausbaukonzept

Stand: 2026-11-04. Erstellt von einem Agent-Team (UX, Frontend, Backend, Security).

Verifikationsstatus der Quellen:
- **Security- und Backend-Befunde:** im Code geprüft, mit Datei:Zeile.
- **UX-Konzept:** ohne Code-Einsicht nach Beschreibung entworfen. Umsetzbarkeit ist abzugleichen.
- **Frontend-Plan:** nur `app/admin/page.tsx` per Grep geprüft, Zeilenangaben ausserhalb der Treffer sind ungeprüft. Seine Rollennamen (`superadmin/admin/support`) sind durch `super_admin/org_admin` zu ersetzen.

## 1. Ist-Zustand

**Anzeige in `/admin`:** eine lange Seite mit Kopfzeile ("Zuletzt geöffnet"), 8 KPI-Karten, 5 Quick-Actions und den Sektionen Kostenübersicht, Organisationen, Nutzer, Kosten pro Org, Rechnungen & Exporte, Aktivitäten und Systemstatus. `/admin/org` ist die Ansicht für org_admins, `/admin/norms` die Normen-DB mit ÖREB-Mappings.

**Funktionen:** Organisationen anlegen, bearbeiten, pausieren, schliessen, archivieren und löschen. Nutzer einladen, Rolle ändern und entfernen. Normen hochladen und promoten. Audit-Log pro Org.

**Nicht vorhanden oder nicht wirksam:**
- Das Dashboard ist nicht anpassbar.
- "Bericht exportieren" ist ein Stub.
- Der Aktivitätsfeed liegt im localStorage.
- Limits (`user_limit`, `project_limit`, `storage_limit_gb`, `monthly_budget`) und der Org-Status werden nirgends serverseitig geprüft.
- Kosten: Es werden nur Analysen mit Status `done` gezählt, Chat-Kosten fehlen, Storage/DB/OCR/Infra sind fest 0, und USD wird als CHF ausgegeben (`app/api/v1/admin/costs/route.ts`).
- Es gibt keinen Cron (`vercel.json` enthält nur das Framework).

## 2. Sicherheitsfundament (zuerst)

Alle Punkte wurden im Code bestätigt.

| Befund | Stelle | Risiko |
|---|---|---|
| Admin-E-Mails dreifach im Code, davon einmal im Client-Bundle | `middleware.ts:4-9`, `lib/auth.ts:15-20`, `components/admin/AdminReturnFab.tsx:7` | hoch |
| Zweiter, ungeprüfter super_admin-Pfad: `users.role='super_admin'` ist erlaubt und wird von `auth.ts:104-109` übernommen | `admin/users/[id]/route.ts:5`, `20240006_permissions.sql:13` | hoch |
| Keine MFA-Pflicht | nirgends | hoch |
| Audit-Fehler werden verschluckt, Eintrag nach der Mutation (nicht atomar) | `lib/auditLog.ts:26-39` | mittel |
| `audit_log` nicht append-only, FK ohne `ON DELETE` | `20260912000001`, Kommentar "append-only" stimmt nicht | mittel |
| ÖREB-Mappings ohne Audit | `admin/oereb-mappings/route.ts` | mittel |
| Letzter org_admin kann herabgestuft oder entfernt werden, Selbst-Downgrade per PATCH möglich | `admin/users/[id]`, `admin/orgs/[id]/users` | mittel |
| `/admin/org` ist von der Middleware ausgenommen, Schutz nur in den Routen | `middleware.ts:101` | mittel |
| Org-Wechsel (Cookie `tb_active_org_id`) wird nicht protokolliert | `lib/auth.ts:34` | mittel |

**Reihenfolge (Aufwand):**
1. **Audit härten (M):** SQL-Funktion `admin_mutate_with_audit` führt Mutation und Eintrag in einer Transaktion aus. Trigger gegen UPDATE und DELETE, Pflichtfelder (Akteur, `request_id`, Vorher/Nachher). `logAudit` wirft bei Fehler und bricht die Aktion ab. ÖREB-Mappings einbinden.
2. **Letzten org_admin schützen (S):** Prüfung in beiden PATCH- und DELETE-Routen, Selbst-Downgrade blockieren.
3. **`platform_admins` statt E-Mail-Liste (M):** Tabelle plus `is_platform_admin()`. Bootstrap per Migration mit den heutigen Admins, damit niemand ausgesperrt wird. Übergang: erst `ADMIN_EMAILS || is_platform_admin` mit Abweichungs-Log, dann alle drei Listen entfernen, dann `super_admin` aus `ALLOWED_ROLES` und dem `users.role`-CHECK streichen. Notzugang per SQL in der Supabase-Konsole.
4. **MFA/AAL2 (M):** Erst die TOTP-Enrollment-Seite bauen, dann erzwingen (sonst Aussperrung). Prüfung zentral in `getAuthUser`, die Middleware nur als UX-Redirect. Für org_admin zunächst Hinweis, später Pflicht.
5. **Vier-Augen (L):** `pending_actions` mit `approved_by <> requested_by`, zunächst für Org-Löschung und Rollenvergabe.
6. **Impersonation "Ansicht als" (L):** nur lesend, signiertes Token (15 min) mit Grund, schreibende Routen lehnen ab, Banner, Start und Ende im Audit.
7. **Datenexport und -löschung pro Org (L, DSG):** Export als Job, Löschung als Soft-Delete mit Frist, danach hartes Löschen inkl. Storage. Setzt Punkt 5 voraus.

## 3. Steuerung durchsetzen

Neue `lib/guards.ts` mit `assertOrgActive`, `assertWithinLimits(kind)` und `assertBudget`. super_admin ist ausgenommen.

| Guard | Einhängen in |
|---|---|
| Org aktiv | alle schreibenden Routen |
| `user_limit` (Nutzer plus offene Einladungen) | `admin/invite` |
| `project_limit` | `projects` POST |
| `storage_limit_gb` | `analyses/uploads`, `standards/upload`, `norms/custom` |
| `monthly_budget` | `analyses` POST (vor dem Insert), `chat` |

**Zählen:** `count: exact, head: true` auf `users` und `projects`. Storage über die vorhandene RPC `org_storage_bytes` mit 60-s-Cache oder Tabelle `org_usage`. Monatskosten über eine Tabelle `org_usage_month`, atomar beim Abschluss einer Analyse hochgezählt.

**Kosten korrigieren:**
- Umrechnung über `USD_CHF_RATE` oder `fx_rates`.
- Tabelle `cost_rates` für Storage, DB und Infra.
- Chat-Kosten (`chat_messages.cost_usd`) einbeziehen.
- Fehlgeschlagene und abgebrochene Analysen mitzählen.
- Aggregation per SQL-RPC `org_month_costs` statt im JS.

## 4. Dashboard bearbeiten

**Widget-Registry** (`components/admin/dashboard/registry.tsx`): Pro Widget `id`, Titel, Komponente, `defaultVisible`, `defaultOrder`, erlaubte Rollen, optional Breite und `locked`. Widgets erhalten Daten und Aktionen über einen `ctx`-Parameter und holen sich selbst nichts.

Widgets: Kennzahlen (gesperrt, immer sichtbar), Schnellaktionen, Kostenübersicht, Organisationen, Nutzer, Kosten pro Org, Rechnungen, Systemstatus, Aktivitäten.

**Gespeichert wird pro Admin:**
```json
{"v":1,"widgets":[{"id":"kpis","visible":true},{"id":"orgs","visible":true},{"id":"system","visible":false}],"updatedAt":"..."}
```
Die Reihenfolge ergibt sich aus der Position. Beim Laden werden unbekannte IDs verworfen, neue Widgets mit Default angehängt und Widgets ohne passende Rolle gefiltert.

**Persistenz:** Tabelle `admin_dashboard_views(user_id pk, view jsonb, updated_at)` mit RLS `user_id = auth.uid()`. Route `admin/dashboard-view` (GET, PUT) mit Whitelist und 4-KB-Limit. localStorage nur als Fallback, mit einmaliger Migration. Für spätere Ansichten "Betrieb / Finanzen / Support" besser gleich `admin_views(user_id, name, layout, range, compare, is_default, scope)` mit Feld `scope` (user oder org).

**Bedienung:**
- Button "Anpassen" in der Kopfzeile schaltet einen Edit-Modus mit Banner ein.
- Pro Widget: Griff, Auge (ein/aus), Pfeile hoch und runter. Ausgeblendete Widgets bleiben im Edit-Modus gedimmt sichtbar.
- Drag-and-Drop mit HTML5 als Zusatz. Die Pfeile bleiben der barrierefreie Weg, mit `aria-live`-Ansage.
- Zeitraum und Vergleich sind auch ausserhalb des Edit-Modus änderbar. Eine Abweichung von der gespeicherten Ansicht wird markiert.
- "Fertig" speichert mit Toast "Rückgängig". Reset mit Bestätigung. Mobil: Listen-Editor als Bottom-Sheet.

```
[Ansicht: Betrieb v] [Zeitraum: 30 Tage v] [vs. Vorperiode v]   [Anpassen]
--- Edit-Modus ---------------------------------------------------------
| Du bearbeitest "Betrieb"   [Zurücksetzen] [Als neue Ansicht…] [Fertig] |
| KPI-Karten   ::[x Nutzer] ::[x Org.] ::[ ] Kosten  [+ Hinzufügen]      |
| :: Kostenübersicht                       [Auge] [Breite: ½ | 1/1]       |
| :: Aktivitäten (ausgeblendet, gedimmt)   [Auge-durchgestrichen]        |
```

## 5. Navigation und Struktur

Die Einzelseite wird zu einem Cockpit mit Unterseiten. `/admin` bleibt eine verdichtete Übersicht, jede Sektion verlinkt per "Alle anzeigen".

```
/admin            Übersicht (Cockpit, anpassbar)
/admin/orgs       Organisationen (+ /[id] mit Tabs in der URL, ?tab=)
/admin/users      Nutzer & Einladungen
/admin/costs      Kosten & Budgets
/admin/billing    Rechnungen & Exporte
/admin/audit      Aktivitäten / Audit-Log
/admin/system     Systemstatus
/admin/norms      Normen
/admin/settings   Einstellungen
```
- Sidebar in Gruppen Betrieb, Finanzen und Plattform, rollenabhängig. Auf Mobil ein Drawer.
- Badges: Rot beim Systempunkt bei Störung, Zahl bei Nutzern für offene Einladungen.
- Breadcrumbs, "Zuletzt geöffnet" in der Sidebar.
- `OrgDetailPanel` zunächst als Slide-over behalten, später als eigene Route.

## 6. Neue Funktionen

**Globales Audit-Log** (`admin/audit-log`):
- Filter nach Org, Aktion, Akteur, Zeitraum und Text.
- Keyset-Paginierung `(created_at, id)`.
- Neue Indizes: `(created_at DESC, id DESC)`, `(action, created_at DESC)`, `(actor_email, created_at DESC)`.
- Neue Spalten: `ip`, `request_id`, `result`.
- CSV-Export gestreamt, mit Schutz gegen Formel-Injection.
- Heute nicht geloggt: Analyse-Abbruch, Plan-Upload, Dokumentenlöschung, Login und Logout, fehlgeschlagene Auth (403), ÖREB-Mappings, Org-Wechsel, Limit- und Budgetänderungen.

**Alert-Center:**
- Tabelle `alerts` mit `dedupe_key` (eindeutig solange offen), Schweregrad, quittiert von und am, stumm bis.
- Regeln: Budget 80 und 100 %, Dienst degradiert, Einladung über 7 Tage offen, Org inaktiv, Fehlerquote der Analysen.
- Auswertung per Vercel-Cron alle 15 Minuten (`CRON_SECRET`) plus Lazy-Auswertung beim Öffnen des Cockpits (60-s-Cache). Automatisches Auflösen, wenn die Regel nicht mehr zutrifft.
- Glocke im Kopf mit Popover, Banner im Cockpit nur bei kritischen Alerts. Schwellwerte in den Einstellungen.

**Analysen-Monitor:**
- Org-übergreifend: laufende, fehlgeschlagene und teure Analysen.
- `analyses` hat kein `started_at`, `finished_at` oder `org_id`, diese Spalten ergänzen, dazu Indizes `(status, created_at)` und partiell auf `running`.
- Verwaiste Analysen: `maxDuration=300`, ein `running` älter als etwa 6 Minuten wird vom Cron auf `error` ("timeout") gesetzt.
- Admin-Abbruch über neue Route `admin/analyses/[id]/cancel` mit Audit.
- Neustart bedeutet: neue Analyse aus denselben `document_files` starten. Dafür die POST-Logik in `lib/` auslagern.

**Command-Palette** (`Strg+K`): Suche über Orgs, Nutzer, Rechnungen, Normen, dazu Seiten und Aktionen. Ohne Eingabe: "Zuletzt geöffnet".

**Weitere:** `platform_settings` (KI-Modell, Preise, Token-Limits, versioniert und auditiert), versionierte System-Prompts, Plan-Defaults, ÖREB-Kantone ein- und ausschalten, Upload-Limits pro Plan, E-Mail-Templates einsehen, Wartungsbanner, echter Vercel- und Mail-Check im Systemstatus.

## 7. Reihenfolge

| Phase | Inhalt |
|---|---|
| 0 | Sicherheitsfundament: Audit härten, letzter org_admin, `platform_admins`, MFA |
| 1 | Guards: Status, Limits, Budget. Kosten korrigieren |
| 2 | Reine Code-Extraktion von `app/admin/page.tsx` (UI-Helfer, `AdminDataProvider`), ohne Verhaltensänderung |
| 3 | Widget-Registry, Tabelle und Route für Ansichten, Edit-Modus hinter Flag, dann Drag-and-Drop |
| 4 | Unterseiten und Sidebar: orgs, users, costs, audit, system |
| 5 | Globales Audit-Log, Aktivitätsfeed aus der DB |
| 6 | Alerts mit Cron, Command-Palette |
| 7 | Analysen-Monitor, `platform_settings`, Prompts |
| 8 | Vier-Augen, Impersonation, Datenexport und -löschung |

Jede Phase ist einzeln deploybar und rückbaubar. Die Phasen 2 und 3 laufen zuerst ohne Verhaltensänderung für bestehende Nutzer.

## 8. Risiken bei der Umsetzung

- Gemeinsamer Zustand (Orgs, Aktivitäten, `last_opened`) darf bei der Aufspaltung nicht dupliziert werden. Der `AdminDataProvider` ist Pflicht.
- localStorage erst im Effect lesen (Hydration).
- `OrgDetailPanel` (950 Zeilen) und `app/admin/org/page.tsx` (732 Zeilen) haben mehrere Aufrufer, beim Verschieben brechen Props-Verträge.
- Rollenfilter im Client sind nur UX, serverseitige Prüfung bleibt Pflicht.
- Alte Links auf `/admin#...` brauchen Weiterleitungen.
- Es gibt keine Tests, also kein Regressionsnetz. Vor Phase 2 mindestens Smoke-Tests für Aktivitäten und "Zuletzt geöffnet" festlegen.

## 9. Offene Entscheidungen

- Sollen Ansichten später teamweit teilbar sein? Dann `scope` von Anfang an.
- Gibt es neben super_admin und org_admin weitere Plattform-Rollen (z. B. Support, nur lesend)?
- Budget-Stopp hart (Analyse wird abgelehnt) oder weich (nur Warnung)?
- Währung: alles intern in USD speichern und in CHF umrechnen, mit welchem Kurs?
