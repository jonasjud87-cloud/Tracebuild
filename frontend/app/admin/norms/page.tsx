"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AdminNav from "@/components/admin/AdminNav";
import { api } from "@/lib/api";

const CANTONS = [
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR",
  "JU", "LU", "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG",
  "TI", "UR", "VD", "VS", "ZG", "ZH",
];

const JURISDICTIONS = [
  { value: "national", label: "Bund" },
  { value: "cantonal", label: "Kanton" },
  { value: "municipal", label: "Gemeinde" },
] as const;

interface AdminNorm {
  id: string;
  title?: string;
  domain: string;
  layer: number;
  jurisdiction_type: string;
  jurisdiction_name: string | null;
  category: string;
  text: string;
  source_url: string | null;
  zone: string | null;
  org_id: string | null;
  org_name: string | null;
  promoted_from_org_id: string | null;
  promoted_from_org_name: string | null;
  created_at?: string;
  pdf_url?: string | null;
}

function JurisdictionBadge({ norm }: { norm: AdminNorm }) {
  const label =
    norm.jurisdiction_type === "national" ? "Bund"
    : norm.jurisdiction_type === "cantonal" ? `Kanton ${norm.jurisdiction_name ?? ""}`
    : norm.jurisdiction_type === "municipal" ? `Gemeinde ${norm.jurisdiction_name ?? ""}`
    : norm.jurisdiction_name ?? "—";
  return (
    <span className="text-xs bg-[#2862D7]/10 text-[#85A6E9] px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
      {label}
    </span>
  );
}

function OwnerBadge({ norm }: { norm: AdminNorm }) {
  if (!norm.org_id) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400">
        Plattformweit
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(60,63,68,0.5)] text-[#ABAEBB]">
      {norm.org_name ?? "Unbekannte Organisation"}
    </span>
  );
}

function NormRow({
  norm, onPromote, onDelete, promoting,
}: {
  norm: AdminNorm;
  onPromote: (id: string) => void;
  onDelete: (id: string) => void;
  promoting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-[rgba(60,63,68,0.3)] last:border-0">
      <div className="px-5 py-3.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <JurisdictionBadge norm={norm} />
            <span className="text-xs bg-[rgba(60,63,68,0.5)] text-[#ABAEBB] px-2 py-0.5 rounded-full">
              {norm.category}
            </span>
            {norm.zone && (
              <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full font-medium">
                Zone {norm.zone}
              </span>
            )}
            <OwnerBadge norm={norm} />
            {norm.pdf_url && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#2862D7]/10 text-[#85A6E9]">
                PDF
              </span>
            )}
            {norm.promoted_from_org_id && (
              <span className="text-[10px] text-[#7B8299] italic">
                ursprünglich von {norm.promoted_from_org_name ?? "unbekannter Organisation"}
              </span>
            )}
          </div>
          <p className="text-sm text-white font-medium truncate">{norm.title || norm.source_url || "Ohne Titel"}</p>
          {expanded && (
            <>
              <p className="mt-2 text-xs text-[#ABAEBB] leading-relaxed whitespace-pre-wrap">{norm.text}</p>
              {norm.pdf_url && (
                <div className="mt-2">
                  <iframe
                    src={norm.pdf_url}
                    className="w-full rounded-lg border border-[rgba(133,166,233,0.18)]"
                    style={{ height: 480 }}
                    title={`PDF-Vorschau ${norm.title ?? norm.source_url ?? norm.category}`}
                  />
                  <a
                    href={norm.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs text-[#85A6E9] hover:text-white transition-colors"
                  >
                    Original-PDF öffnen ↗
                  </a>
                </div>
              )}
            </>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs text-[#85A6E9] hover:text-white transition-colors"
          >
            {expanded ? "Inhalt verbergen ▲" : "Inhalt anzeigen ▼"}
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {norm.org_id && (
            <button
              onClick={() => onPromote(norm.id)}
              disabled={promoting}
              className="text-xs font-semibold text-[#85A6E9] border border-[#2862D7]/30 rounded-lg px-3 py-1.5 hover:bg-[#2862D7]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {promoting ? "…" : "Für alle Organisationen freigeben"}
            </button>
          )}
          <button
            onClick={() => onDelete(norm.id)}
            className="text-[#7B8299] hover:text-red-400 transition-colors text-lg leading-none px-1"
            title="Löschen"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}


// ── ÖREB-Mapping (Bundes-Pflichtthema → norms.category-Muster) ───────────────

const OEREB_FEDERAL_THEMES: { code: string; label: string }[] = [
  { code: "ch.Nutzungsplanung",                        label: "Nutzungsplanung" },
  { code: "ch.ProjektierungszonenNationalstrassen",    label: "Projektierungszonen Nationalstrassen" },
  { code: "ch.BaulinienNationalstrassen",              label: "Baulinien Nationalstrassen" },
  { code: "ch.ProjektierungszonenEisenbahnanlagen",    label: "Projektierungszonen Eisenbahnanlagen" },
  { code: "ch.BaulinienEisenbahnanlagen",              label: "Baulinien Eisenbahnanlagen" },
  { code: "ch.ProjektierungszonenFlughafenanlagen",    label: "Projektierungszonen Flughafenanlagen" },
  { code: "ch.BaulinienFlughafenanlagen",              label: "Baulinien Flughafenanlagen" },
  { code: "ch.Sicherheitszonenplan",                   label: "Sicherheitszonenplan" },
  { code: "ch.BelasteteStandorte",                     label: "Belastete Standorte" },
  { code: "ch.BelasteteStandorteMilitaer",             label: "Belastete Standorte Militär" },
  { code: "ch.BelasteteStandorteZivileFlugplaetze",    label: "Belastete Standorte zivile Flugplätze" },
  { code: "ch.BelasteteStandorteOeffentlicherVerkehr", label: "Belastete Standorte öffentlicher Verkehr" },
  { code: "ch.Grundwasserschutzzonen",                 label: "Grundwasserschutzzonen" },
  { code: "ch.Grundwasserschutzareale",                label: "Grundwasserschutzareale" },
  { code: "ch.Laermempfindlichkeitsstufen",            label: "Lärmempfindlichkeitsstufen" },
  { code: "ch.StatischeWaldgrenzen",                   label: "Statische Waldgrenzen" },
  { code: "ch.Waldabstandslinien",                     label: "Waldabstandslinien" },
  { code: "ch.Waldreservate",                          label: "Waldreservate" },
];

interface OerebMapping {
  id: string;
  theme_code: string;
  category_pattern: string;
  org_id: string | null;
  active: boolean;
}

function OerebMappingSection({ inputCls }: { inputCls: string }) {
  const [mappings, setMappings] = useState<OerebMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [themeCode, setThemeCode] = useState(OEREB_FEDERAL_THEMES[0].code);
  const [pattern, setPattern] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<OerebMapping[]>("/admin/oereb-mappings");
      setMappings(data ?? []);
      setLoadError(null);
    } catch (e: unknown) {
      setMappings([]);
      setLoadError(e instanceof Error ? e.message : "Mappings konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const p = pattern.trim().toLowerCase();
    if (!p) { setFormError("Bitte ein Kategorie-Muster eingeben."); return; }
    setFormError(null);
    setAdding(true);
    try {
      const created = await api.post<OerebMapping>("/admin/oereb-mappings", { theme_code: themeCode, category_pattern: p });
      setMappings((prev) =>
        [...prev, created].sort((a, b) => a.theme_code.localeCompare(b.theme_code) || a.category_pattern.localeCompare(b.category_pattern))
      );
      setPattern("");
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(m: OerebMapping) {
    setBusyId(m.id);
    try {
      const updated = await api.patch<OerebMapping>("/admin/oereb-mappings", { id: m.id, active: !m.active });
      setMappings((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...updated } : x)));
    } catch { /* Zustand behalten */ } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(m: OerebMapping) {
    if (!confirm(`Mapping ${m.theme_code} → «${m.category_pattern}» löschen?`)) return;
    setBusyId(m.id);
    try {
      await api.delete("/admin/oereb-mappings", { id: m.id });
      setMappings((prev) => prev.filter((x) => x.id !== m.id));
    } catch { /* ignore */ } finally {
      setBusyId(null);
    }
  }

  const themeLabel = (code: string) => OEREB_FEDERAL_THEMES.find((t) => t.code === code)?.label ?? code;

  return (
    <section className="mt-12">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">ÖREB-Mapping</h2>
        <p className="text-sm text-[#7B8299] mt-1">
          Verknüpft Bundes-Pflichtthemen des ÖREB-Katasters mit Normen: Betrifft ein Thema die Parzelle, werden alle
          Normen zugewiesen, deren Kategorie das Muster enthält (Teilstring, Gross-/Kleinschreibung egal).
        </p>
      </div>

      <div className="flex gap-8 items-start">
        <div className="w-72 shrink-0">
          <h3 className="text-sm font-semibold text-white mb-3">Zeile hinzufügen</h3>
          <form onSubmit={handleAdd} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#7B8299] mb-1">ÖREB-Thema</label>
              <select value={themeCode} onChange={(e) => setThemeCode(e.target.value)} className={`${inputCls} appearance-none`}>
                {OEREB_FEDERAL_THEMES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
              <p className="text-[11px] text-[#7B8299] mt-1 font-mono">{themeCode}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#7B8299] mb-1">
                Kategorie-Muster <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="z.B. gewässer, lärm, wald"
                className={inputCls}
              />
            </div>
            {formError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{formError}</p>
            )}
            <button
              type="submit"
              disabled={adding || !pattern.trim()}
              className="w-full bg-[#2862D7] hover:bg-[#3470E8] text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {adding ? "Wird gespeichert…" : "Mapping hinzufügen"}
            </button>
          </form>
        </div>

        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-4 animate-pulse">
              <div className="h-3 bg-[rgba(60,63,68,0.5)] rounded w-1/3 mb-2" />
              <div className="h-3 bg-[rgba(60,63,68,0.5)] rounded w-2/3" />
            </div>
          ) : loadError ? (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-6 text-sm text-[#ABAEBB]">
              {loadError}
              <p className="text-xs text-[#7B8299] mt-1">Ist die Migration 20260902000001_oereb.sql eingespielt?</p>
            </div>
          ) : mappings.length === 0 ? (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-10 text-center text-sm text-[#ABAEBB]">
              Noch keine Mappings vorhanden.
            </div>
          ) : (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-[#7B8299] border-b border-[rgba(60,63,68,0.5)]">
                    <th className="px-5 py-3 font-semibold">Thema</th>
                    <th className="px-5 py-3 font-semibold">Kategorie-Muster</th>
                    <th className="px-5 py-3 font-semibold">Geltung</th>
                    <th className="px-5 py-3 font-semibold">Aktiv</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id} className={`border-b border-[rgba(60,63,68,0.3)] last:border-0 ${m.active ? "" : "opacity-50"}`}>
                      <td className="px-5 py-3 align-top">
                        <p className="text-white font-medium">{themeLabel(m.theme_code)}</p>
                        <p className="text-[11px] text-[#7B8299] font-mono">{m.theme_code}</p>
                      </td>
                      <td className="px-5 py-3 align-top">
                        <span className="text-xs bg-[rgba(60,63,68,0.5)] text-[#ABAEBB] px-2 py-0.5 rounded-full font-mono">{m.category_pattern}</span>
                      </td>
                      <td className="px-5 py-3 align-top">
                        {m.org_id ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(60,63,68,0.5)] text-[#ABAEBB]">Organisation</span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400">Plattformweit</span>
                        )}
                      </td>
                      <td className="px-5 py-3 align-top">
                        <button
                          onClick={() => handleToggle(m)}
                          disabled={busyId === m.id}
                          title={m.active ? "Deaktivieren" : "Aktivieren"}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${m.active ? "bg-[#2862D7]" : "bg-[rgba(60,63,68,0.7)]"}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${m.active ? "translate-x-4" : "translate-x-0.5"}`} />
                        </button>
                      </td>
                      <td className="px-5 py-3 align-top text-right">
                        <button
                          onClick={() => handleDelete(m)}
                          disabled={busyId === m.id}
                          className="text-[#7B8299] hover:text-red-400 transition-colors text-lg leading-none px-1 disabled:opacity-40"
                          title="Löschen"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function AdminNormsPage() {
  const [userEmail, setUserEmail] = useState("");
  const [norms, setNorms] = useState<AdminNorm[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<"all" | "platform" | "org">("all");
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [jurisdictionType, setJurisdictionType] = useState<"national" | "cantonal" | "municipal">("cantonal");
  const [canton, setCanton] = useState("ZH");
  const [municipality, setMunicipality] = useState("");
  const [zone, setZone] = useState("");
  const [category, setCategory] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setUserEmail(data.user.email ?? "");
    });
  }, []);

  const loadNorms = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ domain: "bau" });
      if (ownerFilter === "platform") params.set("platform_only", "true");
      const data = await api.get<AdminNorm[]>(`/admin/norms?${params}`);
      setNorms(data ?? []);
    } catch {
      setNorms([]);
    } finally {
      setLoading(false);
    }
  }, [ownerFilter]);

  useEffect(() => { loadNorms(); }, [loadNorms]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setUploadError("Bitte eine Datei auswählen."); return; }
    if (!category.trim()) { setUploadError("Bitte eine Kategorie eingeben."); return; }
    if (jurisdictionType === "municipal" && !municipality.trim()) { setUploadError("Bitte eine Gemeinde eingeben."); return; }

    setUploadError(null);
    setUploadSuccess(null);
    setUploading(true);
    try {
      const jurisdictionName = jurisdictionType === "national" ? "" : jurisdictionType === "municipal" ? municipality.trim() : canton;
      const form = new FormData();
      form.append("file", file);
      form.append("domain", "bau");
      form.append("jurisdiction_type", jurisdictionType);
      form.append("jurisdiction_name", jurisdictionName);
      form.append("category", category.trim());
      form.append("source_name", sourceName.trim());
      form.append("zone", zone.trim());

      const result = await api.postForm<{ count: number; jurisdiction_name: string; category: string }>(
        "/admin/norms/upload", form
      );
      setUploadSuccess(`${result.count} Eintrag gespeichert · Plattformweit · ${result.category}`);
      setFile(null);
      setCategory("");
      setSourceName("");
      setZone("");
      if (fileRef.current) fileRef.current.value = "";
      loadNorms();
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setUploading(false);
    }
  }

  async function handlePromote(id: string) {
    setPromotingId(id);
    try {
      const updated = await api.post<AdminNorm>(`/admin/norms/${id}/promote`, {});
      setNorms((prev) => prev.map((n) => (n.id === id ? { ...n, ...updated } : n)));
    } catch {
      /* keep previous state */
    } finally {
      setPromotingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Diese Norm dauerhaft löschen?")) return;
    try {
      await api.delete(`/admin/norms/${id}`);
      setNorms((prev) => prev.filter((n) => n.id !== id));
    } catch {
      /* ignore */
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = norms
    .filter((n) => (ownerFilter === "org" ? !!n.org_id : true))
    .filter((n) =>
      !q ||
      n.title?.toLowerCase().includes(q) ||
      n.category.toLowerCase().includes(q) ||
      n.org_name?.toLowerCase().includes(q) ||
      n.jurisdiction_name?.toLowerCase().includes(q)
    );

  const inputCls = "w-full rounded-lg px-3 py-2 text-sm text-white bg-[rgba(23,37,64,0.6)] border border-[rgba(133,166,233,0.25)] placeholder:text-[#7B8299] focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 focus:border-[#2862D7] transition-colors";

  return (
    <>
      <AdminNav userEmail={userEmail} />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Normen-Datenbank</h1>
          <p className="text-sm text-[#7B8299] mt-1">
            Plattformweit — Normen hier hochgeladen sind für alle Organisationen sichtbar. Du kannst hier ausserdem
            Normen anderer Organisationen einsehen und für alle Organisationen freigeben.
          </p>
        </div>

        <div className="flex gap-8 items-start">
          {/* Upload-Panel */}
          <div className="w-72 shrink-0">
            <h2 className="text-sm font-semibold text-white mb-3">Plattformweite Norm hochladen</h2>
            <form onSubmit={handleUpload} className="space-y-3">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                  dragOver ? "border-[#2862D7] bg-[#2862D7]/10" : "border-[rgba(133,166,233,0.2)] hover:border-[#2862D7]/50"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <p className="text-sm text-[#85A6E9] font-medium truncate">{file.name}</p>
                ) : (
                  <div>
                    <p className="text-sm text-[#ABAEBB]">PDF / TXT</p>
                    <p className="text-xs text-[#7B8299]">Drag & Drop oder klicken</p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#7B8299] mb-1">Ebene</label>
                <select
                  value={jurisdictionType}
                  onChange={(e) => setJurisdictionType(e.target.value as typeof jurisdictionType)}
                  className={`${inputCls} appearance-none`}
                >
                  {JURISDICTIONS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
                </select>
              </div>

              {jurisdictionType === "cantonal" && (
                <div>
                  <label className="block text-xs font-medium text-[#7B8299] mb-1">Kanton</label>
                  <select value={canton} onChange={(e) => setCanton(e.target.value)} className={`${inputCls} appearance-none`}>
                    {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}

              {jurisdictionType === "municipal" && (
                <div>
                  <label className="block text-xs font-medium text-[#7B8299] mb-1">
                    Gemeinde <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={municipality}
                    onChange={(e) => setMunicipality(e.target.value)}
                    placeholder="z.B. Mels"
                    className={inputCls}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#7B8299] mb-1">Zone (optional)</label>
                <input
                  type="text"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  placeholder="z.B. W2"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#7B8299] mb-1">
                  Kategorie <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="z.B. Grenzabstand, Gebäudehöhe"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#7B8299] mb-1">Quelle (optional)</label>
                <input
                  type="text"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="z.B. SIA 500"
                  className={inputCls}
                />
              </div>

              {uploadError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{uploadError}</p>
              )}
              {uploadSuccess && (
                <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{uploadSuccess}</p>
              )}

              <button
                type="submit"
                disabled={uploading || !file}
                className="w-full bg-[#2862D7] hover:bg-[#3470E8] text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {uploading ? "Wird verarbeitet…" : "Plattformweit hochladen"}
              </button>
            </form>
          </div>

          {/* Liste */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Alle Normen
                  {!loading && (
                    <span className="ml-2 text-sm font-normal text-[#7B8299]">
                      ({filtered.length} {filtered.length === 1 ? "Eintrag" : "Einträge"})
                    </span>
                  )}
                </h2>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value as typeof ownerFilter)}
                  className={`${inputCls} w-auto py-1.5 appearance-none`}
                >
                  <option value="all">Alle Eigentümer</option>
                  <option value="platform">Nur Plattformweit</option>
                  <option value="org">Nur Organisationen</option>
                </select>
                <div className="flex-1 sm:w-56">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Titel, Kategorie, Organisation..."
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-4 animate-pulse">
                    <div className="h-3 bg-[rgba(60,63,68,0.5)] rounded w-1/4 mb-2" />
                    <div className="h-3 bg-[rgba(60,63,68,0.5)] rounded w-3/4" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-16 text-center">
                <p className="text-[#ABAEBB] text-sm font-medium">Keine Normen gefunden</p>
                {(search || ownerFilter !== "all") && (
                  <button
                    onClick={() => { setSearch(""); setOwnerFilter("all"); }}
                    className="mt-2 text-sm text-[#85A6E9] hover:underline"
                  >
                    Filter zurücksetzen
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl overflow-hidden">
                {filtered.map((n) => (
                  <NormRow
                    key={n.id}
                    norm={n}
                    onPromote={handlePromote}
                    onDelete={handleDelete}
                    promoting={promotingId === n.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <OerebMappingSection inputCls={inputCls} />
      </main>
    </>
  );
}
