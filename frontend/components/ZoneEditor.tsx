"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import p from "@/app/projects/project.module.css";
import g from "./project-geo.module.css";

export default function ZoneEditor({ projectId, initial, onSaved, onCancel, autoFocus = false, proposal = false }: {
  projectId: string;
  initial: string;
  onSaved: (zone: string) => void;
  onCancel?: () => void;
  accent?: string;
  autoFocus?: boolean;
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
      const updated = await api.patch<{ bauzone?: string | null } | null>(`/projects/${projectId}`, { bauzone: zone });
      onSaved(updated?.bauzone ?? zone);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={g.zone}>
      <div className={g.zoneRow}>
        <input
          type="text"
          aria-label="Bauzone"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Bauzone eingeben (z.B. W2)"
          className={p.input}
          style={{ flex: "1 1 160px", width: "auto", minWidth: 140 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape" && onCancel) onCancel();
          }}
        />
        <button type="button" onClick={handleSave} disabled={saving || !value.trim()} className={`${p.btnNavy} ${p.btnSm}`}>
          {saving ? "..." : confirming ? "Vorschlag bestätigen" : "Speichern"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className={`${p.btnGhost} ${p.btnSm}`}>
            Abbrechen
          </button>
        )}
      </div>
      {proposal && (
        <span className={g.zoneHint}>Nicht gesichert: Erst mit Ihrer Bestätigung gilt die Zone als manuell geprüft.</span>
      )}
      {error && <span role="alert" className={g.zoneError}>{error}</span>}
    </div>
  );
}
