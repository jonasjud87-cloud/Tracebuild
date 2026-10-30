"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import LogoutButton from "@/components/LogoutButton";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface FileEntry {
  ids: string[];
  title?: string;
  jurisdiction_name: string | null;
  category: string;
  source_url: string | null;
  zone: string | null;
  text: string;
  charCount: number;
  pdf_url: string | null;
}

function FileCard({ entry, onDelete }: { entry: FileEntry; onDelete: (ids: string[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-4 group">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
          <span className="text-xs bg-[#2862D7]/10 text-[#85A6E9] px-2 py-0.5 rounded-full font-medium">
            {entry.jurisdiction_name ?? "—"}
          </span>
          <span className="text-xs bg-[rgba(60,63,68,0.5)] text-[#ABAEBB] px-2 py-0.5 rounded-full">{entry.category}</span>
          <span className="text-sm text-white font-medium truncate">📄 {entry.source_url || "—"}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-[#85A6E9] hover:text-white whitespace-nowrap transition-colors"
          >
            {expanded ? "Inhalt verbergen ▲" : "Inhalt anzeigen ▼"}
          </button>
          <button
            onClick={() => onDelete(entry.ids)}
            className="text-[#7B8299] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 text-lg leading-none"
            title="Löschen"
          >×</button>
        </div>
      </div>
      {expanded && (
        <>
          <p className="mt-3 text-sm text-[#ABAEBB] leading-relaxed whitespace-pre-wrap border-t border-[rgba(60,63,68,0.4)] pt-3">
            {entry.text}
          </p>
          {entry.pdf_url && (
            <div className="mt-3 border-t border-[rgba(60,63,68,0.4)] pt-3">
              <iframe
                src={entry.pdf_url}
                className="w-full rounded-lg border border-[rgba(133,166,233,0.18)]"
                style={{ height: 560 }}
                title={`PDF-Vorschau ${entry.source_url ?? entry.category}`}
              />
              <a
                href={entry.pdf_url}
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
    </div>
  );
}

const CANTONS = [
  "AG","AI","AR","BE","BL","BS","FR","GE","GL","GR",
  "JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG",
  "TI","UR","VD","VS","ZG","ZH",
];

interface Standard {
  id: string;
  title?: string;
  domain: string;
  layer: number;
  jurisdiction_type: string;
  jurisdiction_name: string | null;
  category: string;
  text: string;
  source_url: string | null;
  zone?: string | null;
  pdf_url?: string | null;
}

const JURISDICTIONS = [
  { value: "national",  label: "Bund" },
  { value: "cantonal",  label: "Kanton" },
  { value: "municipal", label: "Gemeinde" },
] as const;

export default function StandardsPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [standards, setStandards] = useState<Standard[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [jurisdictionType, setJurisdictionType] = useState<"national" | "cantonal" | "municipal">("cantonal");
  const [canton, setCanton] = useState("ZH");
  const [municipality, setMunicipality] = useState("");
  const [zone, setZone] = useState("");
  const [category, setCategory] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [filterJurisdiction, setFilterJurisdiction] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }
      setEmail(data.user.email ?? "");
    });
  }, [router]);

  const loadStandards = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ domain: "bau" });
      if (filterJurisdiction) {
        params.set("jurisdiction_type", "cantonal");
        params.set("jurisdiction_name", filterJurisdiction);
      }
      const data = await api.get<Standard[]>(`/standards?${params}`);
      setStandards(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [filterJurisdiction]);

  useEffect(() => { loadStandards(); }, [loadStandards]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Bitte eine Datei auswählen."); return; }
    if (!category.trim()) { setError("Bitte eine Kategorie eingeben."); return; }
    if (jurisdictionType === "municipal" && !municipality.trim()) { setError("Bitte eine Gemeinde eingeben."); return; }
    setError(null); setSuccess(null); setUploading(true);
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
        "/standards/upload", form
      );
      setSuccess(`${result.count} Einträge gespeichert · ${result.jurisdiction_name || "Bund"} · ${result.category}`);
      setFile(null); setCategory(""); setSourceName(""); setZone("");
      if (fileRef.current) fileRef.current.value = "";
      loadStandards();
      setTimeout(() => { setUploadOpen(false); setSuccess(null); }, 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(ids: string[]) {
    if (!confirm("Diese Norm-Datei löschen?")) return;
    await Promise.all(ids.map((id) => api.delete(`/standards/${id}`)));
    setStandards((prev) => prev.filter((s) => !ids.includes(s.id)));
  }

  const categories = Array.from(new Set(standards.map((s) => s.category))).sort();

  const fileEntries: FileEntry[] = [];
  const seen = new Map<string, FileEntry>();
  for (const s of standards) {
    if (filterCategory && s.category !== filterCategory) continue;
    const key = `${s.source_url ?? s.id}||${s.jurisdiction_name ?? ""}||${s.category}`;
    if (seen.has(key)) {
      const entry = seen.get(key)!;
      entry.ids.push(s.id);
      entry.text += "\n\n" + s.text;
      entry.charCount += s.text.length;
      if (!entry.pdf_url && s.pdf_url) entry.pdf_url = s.pdf_url;
    } else {
      const entry: FileEntry = {
        ids: [s.id],
        title: s.title,
        jurisdiction_name: s.jurisdiction_name,
        category: s.category,
        source_url: s.source_url,
        zone: s.zone ?? null,
        text: s.text,
        charCount: s.text.length,
        pdf_url: s.pdf_url ?? null,
      };
      seen.set(key, entry);
      fileEntries.push(entry);
    }
  }

  const inputCls = "w-full rounded-lg px-3 py-2 text-sm text-white bg-[rgba(23,37,64,0.6)] border border-[rgba(133,166,233,0.25)] placeholder:text-[#7B8299] focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 focus:border-[#2862D7] transition-colors";

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(120% 90% at 50% -10%,#182541 0%,#0A0E17 55%)" }}>
      <header style={{ background: "rgba(10,14,23,0.85)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: "1px solid rgba(133,166,233,0.12)", position: "sticky", top: 0, zIndex: 40 }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm text-[#7B8299] hover:text-white transition-colors">
              ← Dashboard
            </Link>
            <h1 className="text-xl font-bold text-white">Normen-Datenbank</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#7B8299]">{email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 flex gap-8 items-start">
        {/* Upload-Panel — collapsed to a compact button by default */}
        {!uploadOpen ? (
          <button
            onClick={() => setUploadOpen(true)}
            className="shrink-0 flex items-center gap-2 px-4 py-3 bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl hover:border-[#2862D7]/40 hover:bg-[#2862D7]/8 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[#85A6E9]" aria-hidden="true">
              <path d="M7 1V13M1 7H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-medium text-[#ABAEBB] whitespace-nowrap">Norm hochladen</span>
          </button>
        ) : (
        <div className="w-72 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Norm hochladen</h2>
            <button
              onClick={() => setUploadOpen(false)}
              className="text-[#7B8299] hover:text-white transition-colors text-lg leading-none"
              title="Einklappen"
            >×</button>
          </div>
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
              <input ref={fileRef} type="file" accept=".pdf,.txt" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
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
              <select value={jurisdictionType} onChange={(e) => setJurisdictionType(e.target.value as "national" | "cantonal" | "municipal")}
                className={`${inputCls} appearance-none`}>
                {JURISDICTIONS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
              </select>
            </div>

            {jurisdictionType === "cantonal" && (
              <div>
                <label className="block text-xs font-medium text-[#7B8299] mb-1">Kanton</label>
                <select value={canton} onChange={(e) => setCanton(e.target.value)}
                  className={`${inputCls} appearance-none`}>
                  {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {jurisdictionType === "municipal" && (
              <div>
                <label className="block text-xs font-medium text-[#7B8299] mb-1">
                  Gemeinde <span className="text-red-400">*</span>
                </label>
                <input type="text" required value={municipality} onChange={(e) => setMunicipality(e.target.value)}
                  placeholder="z.B. Mels"
                  className={inputCls} />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#7B8299] mb-1">
                Kategorie <span className="text-red-400">*</span>
              </label>
              <input type="text" required value={category} onChange={(e) => setCategory(e.target.value)}
                placeholder="z.B. Grenzabstand, Gebäudehöhe"
                className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#7B8299] mb-1">Zone (optional)</label>
              <input type="text" value={zone} onChange={(e) => setZone(e.target.value)}
                placeholder="z.B. W2 — leer = gilt für alle Zonen"
                className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#7B8299] mb-1">Quelle (optional)</label>
              <input type="text" value={sourceName} onChange={(e) => setSourceName(e.target.value)}
                placeholder="z.B. PBG ZH § 270"
                className={inputCls} />
            </div>

            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
            {success && <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{success}</p>}

            <button type="submit" disabled={uploading || !file}
              className="w-full bg-[#2862D7] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#3470E8] disabled:opacity-50 transition-colors">
              {uploading ? "Wird verarbeitet…" : "Hochladen & speichern"}
            </button>
          </form>
        </div>
        )}

        {/* Liste */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">
              Hochgeladene Norm-Dateien
              {fileEntries.length > 0 && (
                <span className="ml-2 text-[#7B8299] font-normal">
                  ({fileEntries.length} {fileEntries.length === 1 ? "Datei" : "Dateien"})
                </span>
              )}
            </h2>
            <div className="flex gap-2">
              <select value={filterJurisdiction} onChange={(e) => setFilterJurisdiction(e.target.value)}
                className={`${inputCls} w-auto py-1.5 appearance-none`}>
                <option value="">Alle Kantone</option>
                {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {categories.length > 0 && (
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
                  className={`${inputCls} w-auto py-1.5 appearance-none`}>
                  <option value="">Alle Kategorien</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
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
          ) : fileEntries.length === 0 ? (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-16 text-center">
              <p className="text-[#7B8299] text-sm">Noch keine Normen vorhanden.</p>
              <p className="text-[#7B8299]/70 text-xs mt-1">Lade eine PDF- oder Textdatei hoch.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {fileEntries.map((entry, i) => (
                <FileCard key={i} entry={entry} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
