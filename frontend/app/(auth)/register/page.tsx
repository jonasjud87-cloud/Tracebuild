"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import styles from "../auth.module.css";
import { createClient } from "@/lib/supabase/client";

const EASE = "cubic-bezier(.52,.01,0,1)";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (!data.session) {
      setInfo("Konto erstellt. Bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 10, padding: "11px 14px",
    fontSize: 14, color: "#FFFFFF",
    background: "rgba(7,14,28,0.5)",
    outline: "none",
    transition: `border-color .3s ${EASE}, box-shadow .3s ${EASE}`,
  };

  const focusIn  = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "#F0C99A";
    e.currentTarget.style.boxShadow   = "0 0 0 3px rgba(240,201,154,0.28)";
  };
  const focusOut = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
    e.currentTarget.style.boxShadow   = "none";
  };

  return (
    <div className={styles.glass} style={{
      borderRadius: 18,
      padding: 36,
      maxWidth: 448, margin: "0 auto",
    }}>

      {/* ── Branding ─────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
        <Image
          src="/landing/logo-mark.svg"
          alt="TraceBuild"
          width={364}
          height={520}
          unoptimized
          style={{ height: 52, width: "auto", objectFit: "contain" }}
          priority
        />
        <div style={{ marginTop: 18, textAlign: "center" }}>
          <h1 className={styles.title} style={{ margin: 0 }}>
            Konto erstellen
          </h1>
          <p style={{ fontSize: 14, color: "#B4BFD0", margin: "5px 0 0" }}>
            Starte deine kostenlose Testphase
          </p>
        </div>
      </div>

      {/* ── Form ─────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 14, fontWeight: 500, color: "#B4BFD0", marginBottom: 6 }}>
            Name
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Max Muster"
            style={inputStyle}
            onFocus={focusIn}
            onBlur={focusOut}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 14, fontWeight: 500, color: "#B4BFD0", marginBottom: 6 }}>
            E-Mail
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@firma.ch"
            style={inputStyle}
            onFocus={focusIn}
            onBlur={focusOut}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 14, fontWeight: 500, color: "#B4BFD0", marginBottom: 6 }}>
            Passwort
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Mind. 8 Zeichen"
            style={inputStyle}
            onFocus={focusIn}
            onBlur={focusOut}
          />
        </div>

        {error && (
          <p style={{
            fontSize: 14, color: "#EBA1A1",
            background: "rgba(200,80,80,0.12)",
            border: "1px solid rgba(235,161,161,0.3)",
            borderRadius: 10, padding: "10px 14px",
            margin: 0,
          }}>
            {error}
          </p>
        )}

        {info && (
          <p style={{
            fontSize: 14, color: "#9AD3B8",
            background: "rgba(101,168,138,0.12)",
            border: "1px solid rgba(101,168,138,0.35)",
            borderRadius: 10, padding: "10px 14px",
            margin: 0,
          }}>
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            background: "linear-gradient(90deg,#F0C99A,#D9AC76 55%,#C99A62)", color: "#07142B",
            padding: "12px 0", border: "none",
            borderRadius: 10, fontSize: 14, fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
            transition: `all .4s ${EASE}`,
            marginTop: 8, letterSpacing: "0.02em",
          }}
          onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.filter = "brightness(1.07)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
        >
          {loading ? "Konto wird erstellt..." : "Konto erstellen →"}
        </button>
      </form>

      {/* ── Footer link ───────────────────────────────────── */}
      <p style={{ textAlign: "center", fontSize: 14, color: "#98A5BA", margin: "24px 0 0" }}>
        Bereits registriert?{" "}
        <Link
          href="/login"
          style={{ color: "#F0C99A", fontWeight: 500, textDecoration: "none", transition: `color .3s ${EASE}` }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#F0C99A"; }}
        >
          Anmelden
        </Link>
      </p>
    </div>
  );
}
