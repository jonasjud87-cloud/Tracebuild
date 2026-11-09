"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import styles from "../auth.module.css";
import { createClient } from "@/lib/supabase/client";

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

  const inputClass = `${styles.input} ${styles.inputPlain}`;

  return (
    <div className={`${styles.glass} ${styles.card}`}>
      <div className={styles.head}>
        <Image
          className={styles.mark}
          src="/landing/logo-tb.svg"
          alt="TraceBuild"
          width={40}
          height={57}
          unoptimized
          style={{ width: 40, height: "auto" }}
          priority
        />
        <h1 className={styles.title}>Konto erstellen</h1>
        <p className={styles.subtitle}>Starte deine kostenlose Testphase</p>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.group}>
          <label htmlFor="register-name" className={styles.label}>Name</label>
          <input
            id="register-name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Max Muster"
            className={inputClass}
          />
        </div>

        <div className={styles.group}>
          <label htmlFor="register-email" className={styles.label}>E-Mail</label>
          <input
            id="register-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@firma.ch"
            className={inputClass}
          />
        </div>

        <div className={styles.group}>
          <label htmlFor="register-password" className={styles.label}>Passwort</label>
          <input
            id="register-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Mind. 8 Zeichen"
            className={inputClass}
          />
        </div>

        <div role="alert">
          {error && <p className={styles.error}>{error}</p>}
        </div>

        {info && <p className={styles.info} role="status">{info}</p>}

        <button type="submit" disabled={loading} className={styles.submit}>
          {loading ? "Konto wird erstellt..." : "Konto erstellen →"}
        </button>
      </form>

      <p className={styles.footnote}>
        Bereits registriert?{" "}
        <Link href="/login" className={styles.link}>
          Anmelden
        </Link>
      </p>
    </div>
  );
}
