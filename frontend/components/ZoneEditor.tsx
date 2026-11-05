"use client";

import { useState } from "react";
import { api } from "@/lib/api";

/**
 * Inline-Editor für die Bauzone. Speichert per PATCH: Die Route setzt damit
 * zone_source = 'manual', die manuelle Zone gewinnt. Nur für Organisations-Admins anzeigen.
 */
export default function ZoneEditor({ projectId, initial, onSaved, onCancel, accent = "rgba(133,166,233,0.3)", autoFocus = false, proposal = false }: {
  projectId: string;
  initial: string;
  onSaved: (zone: string) => void;
  onCancel?: () => void;
  accent?: string;
  autoFocus?: boolean;
  /** `initial` ist ein unsicherer Vorschlag aus dem ÖREB, noch nicht gesichert. */
  proposal?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirming = proposal && value.trim() !== "" && value.trim() === initial.trim();

  async function handleSave() {
    const zone = value.trim();
    if (!zone) return;
    setSaving(true);
    setError(null);
    try {
      // Angezeigt wird, was der Server gespeichert hat.
      const updated = await api.patch<{ bauzone?: string | null } | null>(`/projects/${projectId}`, { bauzone: zone });
      onSaved(updated?.bauzone ?? zone);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          aria-label="Bauzone"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Bauzone eingeben (z.B. W2)"
          style={{ flex: 1, minWidth: 140, border: `1px solid ${accent}`, borderRadius: 8, padding: "6px 12px", fontSize: 13, color: "#fff", background: "rgba(10,14,23,0.6)", outline: "none", fontFamily: "inherit" }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape" && onCancel) onCancel();
          }}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !value.trim()}
          style={{ padding: "6px 14px", background: "#2862D7", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", cursor: saving || !value.trim() ? "not-allowed" : "pointer", opacity: saving || !value.trim() ? 0.5 : 1, fontFamily: "inherit" }}
        >
          {saving ? "..." : confirming ? "Vorschlag bestätigen" : "Speichern"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{ padding: "6px 10px", background: "none", color: "#7B8299", borderRadius: 8, fontSize: 13, border: "1px solid rgba(133,166,233,0.2)", cursor: "pointer", fontFamily: "inherit" }}
          >
            Abbrechen
          </button>
        )}
      </div>
      {proposal && (
        <span style={{ fontSize: 11, color: "#FBBF24" }}>Nicht gesichert: Erst mit Ihrer Bestätigung gilt die Zone als manuell geprüft.</span>
      )}
      {error && <span role="alert" style={{ fontSize: 12, color: "#F87171" }}>{error}</span>}
    </div>
  );
}
