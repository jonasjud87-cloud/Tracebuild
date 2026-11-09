"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import AuthBackButton from "../AuthBackButton";
import styles from "../auth.module.css";

function MailIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v.38l-9 5.62-9-5.62V5.5Z" />
      <path d="M21 8.24V18.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V8.24l8.47 5.29a1 1 0 0 0 1.06 0L21 8.24Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path
        fillRule="evenodd"
        d="M7 10V8a5 5 0 0 1 10 0v2h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H7Zm2 0h6V8a3 3 0 0 0-6 0v2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    router.push("/admin");
    router.refresh();
  }

  return (
    <>
      <AuthBackButton />
      <div className={`${styles.glass} ${styles.card}`}>
        <div className={styles.head}>
          <Image className={styles.mark} style={{ width: 40, height: "auto" }} src="/landing/logo-tb-dark.svg" alt="TraceBuild" width={40} height={57} unoptimized priority />
          <h1 className={styles.title}>Willkommen zurück</h1>
          <p className={styles.subtitle}>Melde dich bei deinem Konto an</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.group}>
            <label htmlFor="login-email" className={styles.label}>E-Mail</label>
            <div className={styles.control}>
              <MailIcon />
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@firma.ch"
                className={styles.input}
              />
            </div>
          </div>

          <div className={styles.group}>
            <label htmlFor="login-password" className={styles.label}>Passwort</label>
            <div className={styles.control}>
              <LockIcon />
              <input
                id="login-password"
                name="password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`${styles.input} ${styles.inputPw}`}
              />
              <button
                type="button"
                className={styles.eye}
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Passwort verbergen" : "Passwort anzeigen"}
                aria-pressed={showPw}
              >
                <EyeIcon off={showPw} />
              </button>
            </div>
          </div>

          <div role="alert">
            {error && <p className={styles.error}>{error}</p>}
          </div>

          <button type="submit" disabled={loading} className={styles.submit}>
            {loading ? "Anmelden..." : "Anmelden →"}
          </button>
        </form>
      </div>
    </>
  );
}
