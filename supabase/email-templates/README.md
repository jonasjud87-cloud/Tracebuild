# Auth-E-Mail-Vorlagen

Supabase Auth verschickt Einladungs- und Passwort-Mails über eigene Vorlagen,
die **im Supabase-Dashboard** gepflegt werden (nicht im Code) — es gibt in
diesem Projekt keine `supabase/config.toml`-Anbindung, über die sie sich per
CLI ausrollen liessen. Die HTML-Dateien hier sind die versionierte Quelle;
zum Wirksamwerden müssen sie manuell eingefügt werden:

1. Supabase-Dashboard → Projekt → **Authentication → Email Templates**
2. **Invite user** → Message body → Inhalt von [`invite.html`](invite.html) einfügen,
   Subject z. B. `Willkommen bei TraceBuild`
3. **Reset password** → Message body → Inhalt von [`reset-password.html`](reset-password.html) einfügen,
   Subject z. B. `Ihr TraceBuild-Passwort zurücksetzen`
4. Speichern.

## Logo

Beide Vorlagen laden das Logo über `{{ .SiteURL }}/email-logo.png` —
das ist die Datei [`frontend/public/email-logo.png`](../../frontend/public/email-logo.png)
(transparenter Hintergrund, 240×240, ~68 KB). Sie ist erst erreichbar,
**nachdem** dieser Branch deployt ist, und nur unter der in den
Auth-Einstellungen hinterlegten Site-URL. Falls dort noch die
Vercel-Preview-URL statt der echten Domain steht, zeigt das Logo erst nach
dem Umstellen korrekt an — bis dahin bricht die Mail nicht, das `<img>`
bleibt nur leer.

## Verfügbare Platzhalter

`{{ .SiteURL }}`, `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .Token }}`,
`{{ .TokenHash }}` — siehe [Supabase-Doku zu Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates).
