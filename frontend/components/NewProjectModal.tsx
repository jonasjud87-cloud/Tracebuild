"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { isOerebSupportedCanton } from "@/lib/oereb/cantons";

const CANTONS = [
  "AG","AI","AR","BE","BL","BS","FR","GE","GL","GR",
  "JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG",
  "TI","UR","VD","VS","ZG","ZH",
];

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface CreateProjectResponse {
  project: { id: string };
  assigned_norms_count: number;
  zone: string | null;
}

const inputStyle: React.CSSProperties = {
  width: "100%", border: "1px solid rgba(133,166,233,0.25)",
  background: "rgba(23,37,64,0.6)", borderRadius: 10, padding: "9px 13px",
  fontSize: 14, color: "#fff", outline: "none", fontFamily: "inherit",
  transition: "box-shadow .15s, border-color .15s", boxSizing: "border-box",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 5 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#ABAEBB" }}>{label}</label>
        {hint && <span style={{ fontSize: 11, color: "#7B8299", fontWeight: 400 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, required }: {
  value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <input
      type="text" required={required} value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
      onFocus={e => { e.currentTarget.style.borderColor = "#2862D7"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(40,98,215,0.2)"; }}
      onBlur={e =>  { e.currentTarget.style.borderColor = "rgba(133,166,233,0.25)"; e.currentTarget.style.boxShadow = "none"; }}
    />
  );
}

export default function NewProjectModal({ onClose, onCreated }: Props) {
  const router = useRouter();
  const [name, setName]                 = useState("");
  const [canton, setCanton]             = useState(CANTONS[0]);
  const [municipality, setMunicipality] = useState("");
  const [parcelNumber, setParcelNumber] = useState("");
  const [bauzone, setBauzone]           = useState("");
  const [error, setError]               = useState<string | null>(null);
  const [loading, setLoading]           = useState(false);

  // Bei angebundenen Kantonen kommt die Bauzone nach dem Anlegen aus dem ÖREB-Auszug;
  // nur ohne Anbindung bleibt das manuelle Feld.
  const oerebSupported = isOerebSupportedCanton(canton);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !municipality.trim() || !parcelNumber.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const result = await api.post<CreateProjectResponse>("/projects", {
        name: name.trim(),
        domain: "bau",
        location: { canton, municipality: municipality.trim(), country: "CH" },
        parcel_number: parcelNumber.trim(),
        bauzone: oerebSupported ? null : (bauzone.trim() || null),
      });
      onCreated();
      onClose();
      router.push(`/projects/${result.project.id}/analysis`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler beim Erstellen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#0E111B", borderRadius: 18, boxShadow: "0 30px 70px rgba(0,0,0,0.5)", border: "1px solid rgba(133,166,233,0.18)", width: "100%", maxWidth: 440, padding: 28, maxHeight: "90vh", overflowY: "auto" }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: "#85A6E9", textTransform: "uppercase", letterSpacing: "0.12em", margin: "0 0 6px" }}>Neues Analyseprojekt</p>
        <h2 style={{ fontSize: 19, fontWeight: 800, color: "#fff", margin: "0 0 22px" }}>Projekt erstellen</h2>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          <Field label="Projektname">
            <TextInput value={name} onChange={setName} required />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Kanton">
              <select
                value={canton} onChange={e => setCanton(e.target.value)}
                style={{ ...inputStyle, appearance: "none" as const }}
                onFocus={e => { e.currentTarget.style.borderColor = "#2862D7"; }}
                onBlur={e =>  { e.currentTarget.style.borderColor = "rgba(133,166,233,0.25)"; }}
              >
                {CANTONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Gemeinde">
              <TextInput value={municipality} onChange={setMunicipality} required />
            </Field>
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid rgba(133,166,233,0.1)", margin: "2px 0" }} />

          <Field label="Parzellennummer">
            <TextInput
              value={parcelNumber}
              onChange={setParcelNumber}
              placeholder="z.B. 1234"
              required
            />
          </Field>

          {oerebSupported ? (
            <Field label="Bauzone">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, border: "1px solid rgba(133,166,233,0.15)", background: "rgba(23,37,64,0.35)", borderRadius: 10, padding: "9px 13px" }}>
                <svg style={{ width: 14, height: 14, color: "#85A6E9", marginTop: 2, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p style={{ fontSize: 12, color: "#ABAEBB", margin: 0, lineHeight: 1.45 }}>
                  Wird nach dem Anlegen automatisch aus dem ÖREB-Kataster ermittelt (Kanton {canton}).
                </p>
              </div>
            </Field>
          ) : (
            <Field label="Bauzone" hint="(optional)">
              <TextInput value={bauzone} onChange={setBauzone} placeholder="z.B. W2" />
              <p style={{ fontSize: 11, color: "#7B8299", margin: "5px 0 0", lineHeight: 1.4 }}>
                Für Kanton {canton} ist noch keine automatische Zonenermittlung angebunden — Bauzone manuell eingeben oder leer lassen.
              </p>
            </Field>
          )}

          {error && (
            <div style={{ fontSize: 13, color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 14px" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 12, paddingTop: 4 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, border: "1px solid rgba(133,166,233,0.25)", color: "#ABAEBB", padding: 10, borderRadius: 10, fontSize: 14, fontWeight: 500, background: "none", cursor: "pointer", fontFamily: "inherit", transition: "background .15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(133,166,233,0.08)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
            >
              Abbrechen
            </button>
            <button type="submit" disabled={loading || !name.trim() || !municipality.trim() || !parcelNumber.trim()}
              style={{
                flex: 1, background: "linear-gradient(90deg,#4fd1ff,#38bdf8 55%,#2862D7)",
                color: "#fff", padding: 10, borderRadius: 10, fontSize: 14, fontWeight: 600,
                border: "none", fontFamily: "inherit",
                cursor: (loading || !name.trim() || !municipality.trim() || !parcelNumber.trim()) ? "not-allowed" : "pointer",
                opacity: (loading || !name.trim() || !municipality.trim() || !parcelNumber.trim()) ? 0.5 : 1,
                boxShadow: "0 4px 16px rgba(40,98,215,0.35)", transition: "filter .15s, opacity .15s",
              }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.filter = "brightness(1.1)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
            >
              {loading ? "Wird erstellt…" : "Projekt erstellen →"}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
