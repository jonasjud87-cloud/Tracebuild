# TraceBuild

KI-Prüfung von Bauplänen gegen die Vorschriften, die für eine Parzelle gelten (ÖREB-Kataster, Bundes-, Kantons- und
Gemeindenormen, Unternehmensnormen). Markt: Schweiz und Liechtenstein.

Stand dieser Datei: 19. November 2026. Für Nutzer gibt es das Handbuch unter `/anleitung`
(`frontend/app/anleitung`), für Admins `docs/`.

## Aufbau

Die App läuft vollständig in `frontend/` (Next.js 14, App Router, TypeScript). Die API sind Next.js-Routen unter
`frontend/app/api/v1/**`; der Client ruft sie über `frontend/lib/api.ts` (Basis `/api/v1`) auf.
`backend/` (FastAPI) wird vom Frontend nicht aufgerufen; CI prüft es nur noch weich.

```
frontend/
  app/
    (auth)/            Login, Registrierung, Passwort festlegen
    dashboard/         Übersicht, Projektliste, Profil
    projects/[id]/     Projekt: analysis, norms, chat, normenblatt, settings
    standards/         Unternehmensnormen (Unternehmensnormen, Eigene Fassungen, Gesetzliche Grundlagen)
    admin/             Plattform-Admin (super_admin); admin/org = Organisation für org_admin
    anleitung/         Handbuch für Organisationen (öffentlich, nicht indexiert)
    datenschutz/, impressum/, page.tsx   Landing (components/landing/v3)
    api/v1/            API-Routen, inkl. internal/ (Analyse-Etappen, Cron Normabgleich)
  components/          UI; landing/v3 = Landing-Design, admin/ = Admin-Portal
  lib/                 Logik ohne UI: Analyse (analysis-*, analysis-stages/), ÖREB (oereb/), Geodaten
                       (geoadmin/), Kenndaten/Normenblatt (kenndaten*), Normabgleich (norm-watch/),
                       Unternehmensnormen (company-norm*), Supabase-Clients (supabase/)
  scripts/             ts-resolve-hook für Tests, ÖREB-Hilfsskripte
  vercel.json          Cron: /api/v1/internal/norm-watch, montags 05:00 UTC
supabase/
  migrations/          Schema, nur additive Migrationen mit Zeitstempel
  ops/                 Betriebs-SQL (Analyse-Etappen aktivieren, Geoportal-Prüfungen, Rollback)
  seed/                Demo-Organisation, nur lokal
  email-templates/     Auth-Mails, siehe README dort
backend/               FastAPI (Altbestand)
docs/                  Konzepte und Prüflisten
```

## Lokal starten

Voraussetzungen: Node 20 für Build und Dev-Server, Node 24 für die Tests (natives Type-Stripping), Zugang zu einem
Supabase-Projekt.

```bash
cd frontend
npm ci
cp .env.local.example .env.local   # Werte eintragen, nie committen
npm run dev                         # http://localhost:3000
```

Supabase lokal: Migrationen aus `supabase/migrations/` in Reihenfolge einspielen, danach optional
`supabase/seed/01_demo_org.sql`. Gegen Produktion nur mit Freigabe.

## Prüfen vor dem Push

Wie die CI (`.github/workflows/ci.yml`, Job «Frontend (Next.js)»):

```bash
cd frontend
npm run lint
npx tsc --noEmit
npm run build      # braucht NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY (Dummy reicht)
npm test           # Node 24, Tests liegen neben dem Code: lib/**/*.test.ts, components/**/*.test.ts
```

## Umgebungsvariablen

Nur Namen, keine Werte. Vorlage: `frontend/.env.local.example`. Alles ohne `NEXT_PUBLIC_` ist nur serverseitig.

**Pflicht**

| Name | Zweck |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase-Projekt |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Öffentlicher Supabase-Schlüssel |
| `SUPABASE_SERVICE_KEY` | Service-Role, nur Server (Einladungen, Admin, Analyse) |
| `ANTHROPIC_API_KEY` | Modellaufrufe (Analyse, Chat, Kenndaten) |
| `NEXT_PUBLIC_SITE_URL` | Basis-URL für Links in Einladungs- und Passwort-Mails; muss zur Supabase Site URL passen |
| `CRON_SECRET` | Schutz des Vercel-Crons `/api/v1/internal/norm-watch` |

**Optional**

| Name | Zweck |
|---|---|
| `NEXT_PUBLIC_API_URL` | Steht in Vorlage und CI, wird im Code nicht gelesen |
| `USD_CHF_RATE` | Umrechnung der Kosten im Admin (Fallback 0.80) |
| `OEREB_BASE_URL_<KT>` | Override der ÖREB-Dienst-URL je Kanton oder `FL`; Standard steht in `lib/oereb/service-quirks.ts` |
| `OEREB_NE_AUTH_HEADER` | Zugang für Dienste, die nur Registrierten liefern (bisher NE); nie loggen |
| `ANALYSIS_STAGE_DISPATCHER` | `browser` statt `pgnet` für die Analyse-Etappen |
| `ANALYSIS_DISPATCH_ORIGIN` | Basis-URL für Etappen-Aufrufe in Produktion |
| `ANALYSIS_MAX_CONCURRENCY` | Parallele Modellaufrufe je Analyse (Standard 8) |
| `ANALYSIS_BUDGET_MS` | Zeitbudget eines Laufs |
| `ANALYSIS_MAX_COST_USD` | Kostengrenze je Analyse |
| `ANALYSIS_MAX_AUTO_PARTS` | Höchstzahl automatisch importierter Reglementsteile je Analyse (Standard 30) |
| `NORM_DIGEST_DISABLED` | `1`: Analyse nutzt den vollen Normtext statt der Prüfauszüge |
| `KENNDATEN_QUARTEN_PDF` | Nur Tests: Pfad zu einem lokalen PDF für `lib/kenndaten-pdf.test.ts` |
| `MONITORING_VERCEL_TOKEN`, `MONITORING_VERCEL_PROJECT_ID`, `MONITORING_VERCEL_TEAM_ID` | Admin «Tools & Dienste»: Vercel |
| `MONITORING_GITHUB_TOKEN`, `MONITORING_GITHUB_REPO` | Admin «Tools & Dienste»: GitHub |
| `MONITORING_RESEND_API_KEY` | Admin «Tools & Dienste»: Resend |
| `MONITORING_SUPABASE_PAT` | Admin «Tools & Dienste»: Supabase Management API |

Ohne `MONITORING_*` zeigt die jeweilige Karte «Nicht eingerichtet» und ruft den Dienst nicht auf.
`VERCEL_ENV` und `VERCEL_PROJECT_PRODUCTION_URL` setzt Vercel selbst.

Backend (`backend/.env.example`, nur falls das FastAPI-Backend gestartet wird): `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `REDIS_URL`, `APP_ENV`, `CORS_ORIGINS`, `USD_CHF_RATE`.

## Konventionen

- API-Antworten: `{ data, error }`. Eingaben mit zod prüfen, Auth und Organisation vor jedem Datenzugriff.
- Supabase: RLS an jeder Tabelle; Service-Role nur serverseitig (`createAdminClient`).
- Modellkosten je Aufruf erfassen (`cost_usd`), auch bei Fehlern.
- Texte, Kommentare und Commits auf Deutsch, Schweizer Schreibweise.

## Weitere Dokumente

- `docs/normabgleich-checkliste.md`: Prüfliste Normabgleich (Admin)
- `docs/admin-portal-konzept.md`: Ausbaukonzept Admin-Portal vom 4. November 2026 (historisch, mit Stand)
- `docs/anleitung-screenshots.md`: Zustand der Screenshots im Handbuch und Aufnahme-Anweisungen
- `supabase/email-templates/README.md`: Auth-Mails einspielen
