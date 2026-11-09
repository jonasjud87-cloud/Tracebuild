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

  if (checking) {
    return (
      <div className={styles.spinnerWrap}>
        <div className={styles.spinner} role="status" aria-label="Laden" />
      </div>
    );
  }

  return (
    <>
      <AuthBackButton />
      <div className={`${styles.glass} ${styles.card}`}>
        <div className={styles.head}>
          <Image className={styles.mark} src="/landing/logo-tb-dark.svg" alt="TraceBuild" width={40} height={57} unoptimized style={{ width: 40, height: "auto" }} priority />
          <h1 className={styles.title}>
            {account?.name ? `Willkommen, ${account.name}` : "Passwort festlegen"}
          </h1>
          <p className={styles.subtitle}>Lege ein Passwort fest, um dein Konto zu aktivieren</p>
          {account?.email && <p className={styles.account}>{account.email}</p>}
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.group}>
            <label htmlFor="sp-password" className={styles.label}>Neues Passwort</label>
            <input
              id="sp-password"
              type="password" required autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={`${styles.input} ${styles.inputPlain}`}
            />
          </div>

          <div className={styles.group}>
            <label htmlFor="sp-confirm" className={styles.label}>Passwort bestätigen</label>
            <input
              id="sp-confirm"
              type="password" required autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              className={`${styles.input} ${styles.inputPlain}`}
            />
          </div>

          <div role="alert">
            {error && <p className={styles.error}>{error}</p>}
          </div>

          <button type="submit" disabled={loading} className={styles.submit}>
            {loading ? "Wird gespeichert..." : "Passwort speichern →"}
          </button>
        </form>
      </div>
    </>
  );
}
