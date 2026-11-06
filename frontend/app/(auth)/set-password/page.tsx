"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import styles from "../auth.module.css";
import AuthBackButton from "../AuthBackButton";

export default function SetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [account, setAccount]     = useState<{ name: string; email: string } | null>(null);
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace("/login"); return; }
      const meta = data.user.user_metadata ?? {};
      setAccount({
        name: typeof meta.full_name === "string" ? meta.full_name : "",
        email: data.user.email ?? "",
      });
      setChecking(false);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) { setError("Das Passwort muss mindestens 8 Zeichen lang sein."); return; }
    if (password !== confirm) { setError("Die Passwörter stimmen nicht überein."); return; }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setError(error.message); setLoading(false); return; }
      // Voller Reload: die users-Zeile (Org + Rolle) wird serverseitig gelesen.
      window.location.replace("/dashboard");
    } catch {
      setError("Das Passwort konnte nicht gespeichert werden. Bitte erneut versuchen.");
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    border: "1px solid rgba(255,255,255,.12)", borderRadius: 10,
    padding: "12px 14px", fontSize: 14, color: "#fff",
    background: "rgba(7,14,28,.5)", outline: "none",
    transition: "border-color .3s, box-shadow .3s",
    fontFamily: "inherit",
  };

  if (checking) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <div style={{ width: 28, height: 28, border: "2px solid rgba(255,255,255,.15)", borderTopColor: "#F0C99A", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <AuthBackButton />
      <div className={styles.glass} style={{
        borderRadius: 20,
        padding: 40,
        maxWidth: 448, margin: "0 auto",
      }}>

        {/* Branding */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
          <Image src="/landing/logo-mark.svg" alt="TraceBuild" width={364} height={520} unoptimized style={{ height: 44, width: "auto", objectFit: "contain" }} priority />
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <h1 className={styles.title} style={{ margin: 0 }}>
              {account?.name ? `Willkommen, ${account.name}` : "Passwort festlegen"}
            </h1>
            <p style={{ fontSize: 14, color: "#aab5c8", margin: "6px 0 0" }}>
              Lege ein Passwort fest, um dein Konto zu aktivieren
            </p>
            {account?.email && (
              <p style={{ fontSize: 13, color: "#98A5BA", margin: "4px 0 0" }}>{account.email}</p>
            )}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "#aab5c8", marginBottom: 8 }}>Neues Passwort</label>
            <input
              type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = "#F0C99A"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(240,201,154,0.28)"; }}
              onBlur={e  => { e.currentTarget.style.borderColor = "rgba(255,255,255,.12)"; e.currentTarget.style.boxShadow = "none"; }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "#aab5c8", marginBottom: 8 }}>Passwort bestätigen</label>
            <input
              type="password" required value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = "#F0C99A"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(240,201,154,0.28)"; }}
              onBlur={e  => { e.currentTarget.style.borderColor = "rgba(255,255,255,.12)"; e.currentTarget.style.boxShadow = "none"; }}
            />
          </div>

          {error && (
            <p style={{ fontSize: 14, color: "#EBA1A1", background: "rgba(200,80,80,0.12)", border: "1px solid rgba(235,161,161,0.3)", borderRadius: 10, padding: "10px 14px", margin: 0 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: "linear-gradient(90deg,#F0C99A,#D9AC76 55%,#C99A62)",
              color: "#07142B", padding: "15px 0", border: "none",
              borderRadius: 10, fontSize: 13.5, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
              transition: "filter .2s, opacity .2s",
              marginTop: 6, letterSpacing: "0.01em",
            }}
            onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.filter = "brightness(1.12)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
          >
            {loading ? "Wird gespeichert..." : "Passwort speichern →"}
          </button>
        </form>
      </div>
    </>
  );
}
