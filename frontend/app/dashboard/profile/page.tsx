"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import DashboardBackdrop from "@/components/dashboard/DashboardBackdrop";
import { useDashboard } from "@/lib/dashboardContext";
import { ROLE_DESCRIPTIONS, roleLabel } from "@/lib/roles";
import s from "../dashboard.module.css";

const MIN_PASSWORD_LENGTH = 8;

type Status = { kind: "ok" | "error"; text: string } | null;

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p role="status" className={`${s.status} ${status.kind === "ok" ? s.statusOk : s.statusErr}`}>
      {status.text}
    </p>
  );
}

export default function ProfilePage() {
  const { email, userName, setUserName, isSuperAdmin, role, activeOrg } = useDashboard();

  // ── Name ──
  const [name, setName] = useState(userName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameStatus, setNameStatus] = useState<Status>(null);
  useEffect(() => { setName(userName); }, [userName]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameStatus(null);
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) { setNameStatus({ kind: "error", text: "Bitte einen Namen eingeben." }); return; }
    setNameBusy(true);
    try {
      const res = await fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const json = await res.json().catch(() => null) as { data: { name: string } | null; error: string | null } | null;
      if (!res.ok || !json?.data) throw new Error(json?.error ?? "Der Name konnte nicht gespeichert werden.");
      setUserName(json.data.name);
      setNameStatus({ kind: "ok", text: "Name gespeichert." });
    } catch (err) {
      setNameStatus({ kind: "error", text: err instanceof Error ? err.message : "Der Name konnte nicht gespeichert werden." });
    } finally {
      setNameBusy(false);
    }
  }

  // ── E-Mail ──
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState<Status>(null);

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailStatus(null);
    const target = newEmail.trim().toLowerCase();
    if (!target) { setEmailStatus({ kind: "error", text: "Bitte eine E-Mail-Adresse eingeben." }); return; }
    if (target === email.toLowerCase()) { setEmailStatus({ kind: "error", text: "Das ist bereits Ihre aktuelle Adresse." }); return; }
    setEmailBusy(true);
    try {
      const { error } = await createClient().auth.updateUser(
        { email: target },
        { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/dashboard/profile")}` },
      );
      if (error) throw error;
      setNewEmail("");
      setEmailStatus({
        kind: "ok",
        text: `Bestätigungslink verschickt. Die neue Adresse ${target} gilt, sobald Sie die Änderung per E-Mail bestätigt haben.`,
      });
    } catch (err) {
      setEmailStatus({ kind: "error", text: err instanceof Error ? err.message : "Die E-Mail-Adresse konnte nicht geändert werden." });
    } finally {
      setEmailBusy(false);
    }
  }

  // ── Passwort ──
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwStatus, setPwStatus] = useState<Status>(null);

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwStatus(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPwStatus({ kind: "error", text: `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` });
      return;
    }
    if (newPassword !== confirmPassword) { setPwStatus({ kind: "error", text: "Die neuen Passwörter stimmen nicht überein." }); return; }
    setPwBusy(true);
    try {
      const supabase = createClient();
      // Das aktuelle Passwort bestätigen, bevor es geändert wird — eine offen
      // gelassene Sitzung allein soll dafür nicht reichen.
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (verifyError) throw new Error("Das aktuelle Passwort ist falsch.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPwStatus({ kind: "ok", text: "Passwort geändert." });
    } catch (err) {
      setPwStatus({ kind: "error", text: err instanceof Error ? err.message : "Das Passwort konnte nicht geändert werden." });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <>
      <section className={`${s.hero} ${s.heroSlim}`}>
        <DashboardBackdrop />
        <div className={s.heroInner}>
          <p className={s.eyebrow}>Konto</p>
          <h1 className={s.h1}>Profil</h1>
          <p className={s.lead}>
            Rolle, Name, E-Mail-Adresse und Passwort Ihres Kontos.
          </p>
        </div>
      </section>

      <div className={`${s.body} ${s.profileBody}`}>
      <div className={s.profile}>

      <section className={`${s.glass} ${s.glassPad} ${s.pCard}`} aria-labelledby="profile-role">
        <h2 id="profile-role" className={s.pTitle}>Rolle</h2>
        <p className={s.pText} style={{ marginBottom: 12 }}>
          {activeOrg ? <>In der Organisation <strong>{activeOrg.name}</strong>.</> : "In Ihrer Organisation."}
        </p>
        {role && (
          <>
            <span className={s.roleTag}>{roleLabel(role)}</span>
            <p className={s.pText} style={{ margin: "12px 0 0" }}>
              {ROLE_DESCRIPTIONS[role] ?? ROLE_DESCRIPTIONS.member}
              {role !== "super_admin" && " Die Rolle kann nur ein Org Admin Ihrer Organisation ändern."}
            </p>
          </>
        )}
      </section>

      <form onSubmit={saveName} className={`${s.glass} ${s.glassPad} ${s.pCard}`}>
        <h2 className={s.pTitle}>Name</h2>
        <p className={s.pText}>So erscheinen Sie in TraceBuild, z. B. in der Mitgliederliste Ihrer Organisation.</p>
        <label htmlFor="profile-name" className={s.label}>Vor- und Nachname</label>
        <input id="profile-name" className={s.input} value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" />
        <button type="submit" className={`${s.btn} ${s.formBtn}`} disabled={nameBusy}>
          {nameBusy ? "Wird gespeichert…" : "Name speichern"}
        </button>
        <StatusLine status={nameStatus} />
      </form>

      <form onSubmit={saveEmail} className={`${s.glass} ${s.glassPad} ${s.pCard}`}>
        <h2 className={s.pTitle}>E-Mail-Adresse</h2>
        <p className={s.pText}>
          Aktuell: <strong style={{ overflowWrap: "anywhere" }}>{email}</strong>.
          Die neue Adresse gilt erst, nachdem Sie die Änderung über den Link in der Bestätigungs-E-Mail bestätigt haben.
        </p>
        {isSuperAdmin ? (
          <p className={s.pText} style={{ margin: 0 }}>
            Für TraceBuild-Administratoren ist die Adresse fest hinterlegt und kann hier nicht geändert werden.
          </p>
        ) : (
          <>
            <label htmlFor="profile-email" className={s.label}>Neue E-Mail-Adresse</label>
            <input id="profile-email" type="email" className={s.input} value={newEmail} onChange={e => setNewEmail(e.target.value)} autoComplete="email" placeholder="name@firma.ch" />
            <button type="submit" className={`${s.btn} ${s.formBtn}`} disabled={emailBusy}>
              {emailBusy ? "Wird gesendet…" : "E-Mail-Adresse ändern"}
            </button>
            <StatusLine status={emailStatus} />
          </>
        )}
      </form>

      <form onSubmit={savePassword} className={`${s.glass} ${s.glassPad} ${s.pCard}`}>
        <h2 className={s.pTitle}>Passwort</h2>
        <p className={s.pText}>Mindestens {MIN_PASSWORD_LENGTH} Zeichen.</p>
        <input type="email" value={email} autoComplete="username" readOnly hidden />
        <label htmlFor="profile-pw-current" className={s.label}>Aktuelles Passwort</label>
        <input id="profile-pw-current" type="password" className={s.input} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
        <div className={s.spacer} />
        <label htmlFor="profile-pw-new" className={s.label}>Neues Passwort</label>
        <input id="profile-pw-new" type="password" className={s.input} value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" required />
        <div className={s.spacer} />
        <label htmlFor="profile-pw-confirm" className={s.label}>Neues Passwort bestätigen</label>
        <input id="profile-pw-confirm" type="password" className={s.input} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
        <button type="submit" className={`${s.btn} ${s.formBtn}`} disabled={pwBusy}>
          {pwBusy ? "Wird geändert…" : "Passwort ändern"}
        </button>
        <StatusLine status={pwStatus} />
      </form>
      </div>
      </div>
    </>
  );
}
