"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  domain: string;
  location: { canton: string; municipality: string; country?: string };
  status: string;
  parcel_number: string | null;
  bauzone: string | null;
  zone_source?: "oereb" | "manual" | null;
  zone_confidence?: "exact" | "coarse" | null;
}

function zoneOriginLabel(p: Project | null): string | null {
  if (!p?.bauzone) return null;
  if (p.zone_source === "manual") return "manuell gesetzt";
  if (p.zone_source === "oereb") return p.zone_confidence === "coarse" ? "Grobklasse aus ÖREB-Auszug" : "aus ÖREB-Auszug";
  return null;
}

const CANTONS = [
  "AG","AI","AR","BE","BL","BS","FR","GE","GL","GR",
  "JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG",
  "TI","UR","VD","VS","ZG","ZH",
];

export default function SettingsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [canton, setCanton] = useState("ZH");
  const [municipality, setMunicipality] = useState("");
  const [parcelNumber, setParcelNumber] = useState("");
  const [bauzone, setBauzone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Project>(`/projects/${params.id}`).then((p) => {
      setProject(p);
      setName(p.name);
      setCanton(p.location?.canton ?? "ZH");
      setMunicipality(p.location?.municipality ?? "");
      setParcelNumber(p.parcel_number ?? "");
      setBauzone(p.bauzone ?? "");
      setLoading(false);
    });
  }, [params.id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      // Bauzone nur mitschicken, wenn sie tatsächlich geändert wurde — das PATCH setzt
      // damit zone_source = 'manual', und eine ÖREB-Zone soll nicht unbeabsichtigt
      // als manuell markiert werden.
      const newZone = bauzone.trim() || null;
      const zoneChanged = newZone !== (project?.bauzone ?? null);
      const updated = await api.patch<Project>(`/projects/${params.id}`, {
        name,
        location: { canton, municipality, country: project?.location?.country ?? "CH" },
        parcel_number: parcelNumber.trim() || null,
        ...(zoneChanged ? { bauzone: newZone } : {}),
      });
      setProject((prev) => {
        const base = prev ? { ...prev, ...(updated ?? {}) } : (updated ?? prev);
        if (!base) return prev;
        return zoneChanged ? { ...base, bauzone: newZone, zone_source: newZone ? "manual" : null, zone_confidence: null } : base;
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Projekt "${project?.name}" wirklich löschen? Diese Aktion ist nicht rückgängig zu machen.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/projects/${params.id}`);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fehler beim Löschen");
      setDeleting(false);
    }
  }

  const inputCls = "w-full rounded-lg px-3 py-2 text-sm text-white bg-[rgba(23,37,64,0.6)] border border-[rgba(133,166,233,0.25)] focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 focus:border-[#2862D7] transition-colors";

  if (loading) {
    return (
      <div className="max-w-xl space-y-4 animate-pulse">
        <div className="h-5 bg-[rgba(60,63,68,0.5)] rounded w-1/3" />
        <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-5 space-y-4">
          <div className="h-4 bg-[rgba(60,63,68,0.5)] rounded w-1/4" />
          <div className="h-9 bg-[rgba(60,63,68,0.5)] rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-semibold text-white mb-6">Projekteinstellungen</h2>

      <form onSubmit={handleSave} className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#7B8299] mb-1">Projektname</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#7B8299] mb-1">Kanton</label>
            <select value={canton} onChange={(e) => setCanton(e.target.value)} className={`${inputCls} appearance-none`}>
              {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#7B8299] mb-1">Gemeinde</label>
            <input
              type="text"
              required
              value={municipality}
              onChange={(e) => setMunicipality(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#7B8299] mb-1">Parzellennummer</label>
            <input
              type="text"
              value={parcelNumber}
              onChange={(e) => setParcelNumber(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#7B8299] mb-1">
              Bauzone
              {zoneOriginLabel(project) && (
                <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  project?.zone_source === "manual"
                    ? "bg-[rgba(133,166,233,0.1)] text-[#ABAEBB]"
                    : project?.zone_confidence === "coarse"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-orange-500/10 text-orange-400"
                }`}>
                  {zoneOriginLabel(project)}
                </span>
              )}
            </label>
            <input
              type="text"
              value={bauzone}
              onChange={(e) => setBauzone(e.target.value)}
              placeholder="z.B. W2"
              className={inputCls}
            />
            <p className="text-[11px] text-[#7B8299] mt-1 leading-snug">
              {project?.zone_source === "oereb"
                ? "Automatisch aus dem ÖREB-Kataster. Eine Änderung hier gilt als manuelle Zone und überschreibt den Auszug."
                : "Eine hier gesetzte Zone gilt als manuell und hat Vorrang vor dem ÖREB-Auszug."}
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#7B8299] mb-1">Domain</label>
          <div className="border border-[rgba(60,63,68,0.5)] rounded-lg px-3 py-2 text-sm bg-[rgba(60,63,68,0.3)] text-[#7B8299]">
            Bau / Architektur
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            Einstellungen gespeichert.
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-[#2862D7] hover:bg-[#3470E8] text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {saving ? "Wird gespeichert…" : "Speichern"}
        </button>
      </form>

      <div className="bg-[#172540] border border-red-500/20 rounded-xl p-5 mt-4">
        <h3 className="text-sm font-medium text-white mb-1">Gefahrenzone</h3>
        <p className="text-xs text-[#7B8299] mb-4">
          Das Löschen eines Projekts entfernt alle zugehörigen Dokumente und Analysen unwiderruflich.
        </p>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 py-2 px-4 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {deleting ? "Wird gelöscht…" : "Projekt löschen"}
        </button>
      </div>
    </div>
  );
}
