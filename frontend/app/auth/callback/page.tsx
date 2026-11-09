"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Auth-Callback.
 *
 * Muss zwingend clientseitig laufen: Supabase leitet Einladungs- und
 * Passwort-Links im Implicit-Flow weiter, d.h. das Token steht im
 * URL-Fragment (`#access_token=…&type=invite`). Ein Server-Route-Handler sieht
 * das Fragment nie — die frühere route.ts hat deshalb bei jeder Einladung nur
 * `?code` gesucht, nichts gefunden und auf /login?error=auth umgeleitet.
 *
 * Unterstützt werden alle drei Varianten:
 *   - Fragment  (#access_token & #refresh_token)  → setSession
 *   - PKCE      (?code)                           → exchangeCodeForSession
 *   - OTP-Hash  (?token_hash & ?type)             → verifyOtp
 */

const PASSWORD_TYPES = new Set(["invite", "recovery", "signup"]);

function safeNext(raw: string | null): string {
  if (!raw) return "";
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // Kaputtes Prozent-Encoding darf den Callback nicht zum Hängen bringen.
    return "";
  }
  // Nur interne Pfade — schützt vor Open Redirect. Auch "/\evil.ch" ist
  // gefährlich: Browser normalisieren den Backslash zu "/", daraus wird
  // "//evil.ch" und damit ein externer Host.
  if (!/^\/[^/\\]/.test(value)) return "";
  return value;
}

/** Wartet, bis der Supabase-Cookie gesetzt ist — sonst schickt die Middleware
 *  den frisch eingeloggten Nutzer beim nächsten Request zurück auf /login. */
async function waitForAuthCookie(timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (/(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(document.cookie)) return;
    await new Promise(r => setTimeout(r, 40));
  }
}

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));

      const rawError =
        url.searchParams.get("error_description") ?? hash.get("error_description") ??
        url.searchParams.get("error")             ?? hash.get("error");

      if (rawError) {
        if (!cancelled) setError(decodeURIComponent(rawError.replace(/\+/g, " ")));
        return;
      }

      const type = (hash.get("type") ?? url.searchParams.get("type") ?? "").trim();
      const next =
        safeNext(url.searchParams.get("next")) ||
        (PASSWORD_TYPES.has(type) ? "/set-password" : "/dashboard");

      try {
        const accessToken  = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        const code         = url.searchParams.get("code");
        const tokenHash    = url.searchParams.get("token_hash");

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            type: type as EmailOtpType,
            token_hash: tokenHash,
          });
          if (error) throw error;
        } else {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error("Der Link ist ungültig oder bereits abgelaufen.");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Der Link konnte nicht verarbeitet werden.");
        }
        return;
      }

      await waitForAuthCookie();
      if (cancelled) return;
      // replace statt push: Fragment mit dem Token verschwindet aus der History.
      window.location.replace(next);
    })();

    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "#f6f3ee", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
        <p style={{ fontSize: 15, color: "#a3201a", background: "#fde7e5", border: "1px solid rgba(163,32,26,0.35)", borderRadius: 12, padding: "10px 14px", maxWidth: 440, margin: 0 }}>
          {error}
        </p>
        <p style={{ fontSize: 15, color: "#46464a", margin: 0, maxWidth: 440 }}>
          Bitte fordere bei deinem Administrator eine neue Einladung an.
        </p>
        <a href="/login" style={{ fontSize: 15, fontWeight: 600, color: "#151414", textDecoration: "underline", textUnderlineOffset: 3 }}>Zur Anmeldung →</a>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f6f3ee", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 28, height: 28, border: "2px solid rgba(21,20,20,.14)", borderTopColor: "#151414", borderRadius: "50%", animation: "tb-spin 0.8s linear infinite" }} />
      <style>{`@keyframes tb-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
