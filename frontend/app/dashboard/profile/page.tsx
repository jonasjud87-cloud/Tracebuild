"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDashboard } from "@/lib/dashboardContext";
import { ROLE_DESCRIPTIONS, roleLabel } from "@/lib/roles";

const MIN_PASSWORD_LENGTH = 8;

const card: React.CSSProperties = {
  background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.18)",
  borderRadius: 18, padding: 24, marginBottom: 20,
};
const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 4px" };
const cardText: React.CSSProperties = { fontSize: 13, color: "#7B8299", margin: "0 0 18px", lineHeight: 1.5 };
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 500, color: "#ABAEBB", margin: "0 0 6px" };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 12, fontSize: 14, color: "#fff",
  background: "rgba(23,37,64,0.6)", border: "1px solid rgba(133,166,233,0.25)", outline: "none", fontFamily: "inherit",
};
const button: React.CSSProperties = {
  marginTop: 16, padding: "10px 18px", borderRadius: 12, border: "none", cursor: "pointer",
  background: "#2862D7", color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "inherit",
};

type Status = { kind: "ok" | "error"; text: string } | null;

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  const ok = status.kind === "ok";
  return (
    <p role="status" style={{
      margin: "14px 0 0", fontSize: 13, borderRadius: 10, padding: "9px 12px",
      color: ok ? "#34d399" : "#f87171",
      background: ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
      border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
    }}>
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
    <div style={{ maxWidth: 560 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: "#85A6E9", textTransform: "uppercase", letterSpacing: "0.14em", margin: "0 0 10px" }}>Konto</p>
      <h1 style={{ fontSize: 32, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em", margin: "0 0 8px", lineHeight: 1.1 }}>Profil</h1>
      <p style={{ fontSize: 15, color: "#7B8299", margin: "0 0 32px", lineHeight: 1.5 }}>
        Rolle, Name, E-Mail-Adresse und Passwort Ihres Kontos.
      </p>

      <section style={card} aria-labelledby="profile-role">
        <h2 id="profile-role" style={cardTitle}>Rolle</h2>
        <p style={{ ...cardText, margin: "0 0 12px" }}>
          {activeOrg ? <>In der Organisation <span style={{ color: "#fff" }}>{activeOrg.name}</span>.</> : "In Ihrer Organisation."}
        </p>
        {role && (
          <>
            <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, color: "#85A6E9", background: "rgba(40,98,215,0.12)", padding: "4px 10px", borderRadius: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {roleLabel(role)}
            </span>
            <p style={{ ...cardText, margin: "12px 0 0" }}>
              {ROLE_DESCRIPTIONS[role] ?? ROLE_DESCRIPTIONS.member}
              {role !== "super_admin" && " Die Rolle kann nur ein Org Admin Ihrer Organisation ändern."}
            </p>
          </>
        )}
      </section>

      <form onSubmit={saveName} style={card}>
        <h2 style={cardTitle}>Name</h2>
        <p style={cardText}>So erscheinen Sie in TraceBuild, z. B. in der Mitgliederliste Ihrer Organisation.</p>
        <label htmlFor="profile-name" style={label}>Vor- und Nachname</label>
        <input id="profile-name" style={input} value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" />
        <button type="submit" style={{ ...button, opacity: nameBusy ? 0.6 : 1 }} disabled={nameBusy}>
          {nameBusy ? "Wird gespeichert…" : "Name speichern"}
        </button>
        <StatusLine status={nameStatus} />
      </form>

      <form onSubmit={saveEmail} style={card}>
        <h2 style={cardTitle}>E-Mail-Adresse</h2>
        <p style={cardText}>
          Aktuell: <span style={{ color: "#fff", overflowWrap: "anywhere" }}>{email}</span>.
          Die neue Adresse gilt erst, nachdem Sie die Änderung über den Link in der Bestätigungs-E-Mail bestätigt haben.
        </p>
        {isSuperAdmin ? (
          <p style={{ ...cardText, margin: 0 }}>
            Für TraceBuild-Administratoren ist die Adresse fest hinterlegt und kann hier nicht geändert werden.
          </p>
        ) : (
          <>
            <label htmlFor="profile-email" style={label}>Neue E-Mail-Adresse</label>
            <input id="profile-email" type="email" style={input} value={newEmail} onChange={e => setNewEmail(e.target.value)} autoComplete="email" placeholder="name@firma.ch" />
            <button type="submit" style={{ ...button, opacity: emailBusy ? 0.6 : 1 }} disabled={emailBusy}>
              {emailBusy ? "Wird gesendet…" : "E-Mail-Adresse ändern"}
            </button>
            <StatusLine status={emailStatus} />
          </>
        )}
      </form>

      <form onSubmit={savePassword} style={card}>
        <h2 style={cardTitle}>Passwort</h2>
        <p style={cardText}>Mindestens {MIN_PASSWORD_LENGTH} Zeichen.</p>
        {/* Hidden username field so password managers attach the new password to this account. */}
        <input type="email" value={email} autoComplete="username" readOnly hidden />
        <label htmlFor="profile-pw-current" style={label}>Aktuelles Passwort</label>
        <input id="profile-pw-current" type="password" style={input} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
        <div style={{ height: 12 }} />
        <label htmlFor="profile-pw-new" style={label}>Neues Passwort</label>
        <input id="profile-pw-new" type="password" style={input} value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" required />
        <div style={{ height: 12 }} />
        <label htmlFor="profile-pw-confirm" style={label}>Neues Passwort bestätigen</label>
        <input id="profile-pw-confirm" type="password" style={input} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
        <button type="submit" style={{ ...button, opacity: pwBusy ? 0.6 : 1 }} disabled={pwBusy}>
          {pwBusy ? "Wird geändert…" : "Passwort ändern"}
        </button>
        <StatusLine status={pwStatus} />
      </form>
    </div>
  );
}
