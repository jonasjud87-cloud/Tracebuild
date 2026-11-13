"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import { CANTONS, JURISDICTIONS, inputCls } from "./admin-norm-types";

interface Props {
  onUploaded: () => void;
  onClose: () => void;
}

export default function AdminNormUpload({ onUploaded, onClose }: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [jurisdictionType, setJurisdictionType] = useState<"national" | "cantonal" | "municipal">("national");
  const [canton, setCanton] = useState("SG");
  const [country, setCountry] = useState<"CH" | "LI" | "all">("CH");
  const [municipality, setMunicipality] = useState("");
  const [zone, setZone] = useState("");
  const [category, setCategory] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Bitte eine Datei auswählen.");
      return;
    }
    if (!category.trim()) {
      setError("Bitte eine Kategorie eingeben.");
      return;
    }
    if (jurisdictionType === "municipal" && !municipality.trim()) {
      setError("Bitte eine Gemeinde eingeben.");
      return;
    }

    setError(null);
    setSuccess(null);
    setUploading(true);
    try {
      const jurisdictionName = jurisdictionType === "national" ? "" : jurisdictionType === "municipal" ? municipality.trim() : canton;
      const form = new FormData();
      form.append("file", file);
      form.append("domain", "bau");
      form.append("jurisdiction_type", jurisdictionType);
      form.append("jurisdiction_name", jurisdictionName);
      if (jurisdictionType === "national") form.append("country", country);
      form.append("category", category.trim());
      form.append("source_name", sourceName.trim());
      form.append("zone", zone.trim());

      const result = await api.postForm<{ count: number; jurisdiction_name: string; category: string }>("/admin/norms/upload", form);
      setSuccess(`Gespeichert: ${result.category}, plattformweit.`);
      setFile(null);
      setCategory("");
      setSourceName("");
      setZone("");
      if (fileRef.current) fileRef.current.value = "";
      onUploaded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section aria-labelledby="norm-upload-title" className="tba-glass tba-glass--flat rounded-[20px] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 id="norm-upload-title" className="text-base font-semibold text-[#151414]">
            Plattformweite Norm hochladen
          </h3>
          <p className="mt-1 text-sm text-[#5f5f64]">
            Sichtbar für alle Organisationen. Bundes- und Kantonsnormen besser über «Rechtsquellen» anbinden, damit sie aktuell bleiben.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-[#6b6153] hover:text-[#151414]">
          Schliessen
        </button>
      </div>

      <form onSubmit={handleUpload} className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex min-h-[140px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
            dragOver ? "border-[#cbbfae] bg-[#cbbfae]/30" : "border-[#8c8b8e] hover:border-[#151414]"
          }`}
        >
          <input ref={fileRef} type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? (
            <p className="truncate text-sm font-medium text-[#6b6153]">{file.name}</p>
          ) : (
            <div>
              <p className="text-sm text-[#46464a]">PDF oder TXT</p>
              <p className="text-sm text-[#5f5f64]">Ziehen oder klicken</p>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-[#5f5f64]">
            Ebene
            <select
              value={jurisdictionType}
              onChange={(e) => setJurisdictionType(e.target.value as typeof jurisdictionType)}
              className={`${inputCls} mt-1 appearance-none`}
            >
              {JURISDICTIONS.map((j) => (
                <option key={j.value} value={j.value}>
                  {j.label}
                </option>
              ))}
            </select>
          </label>

          {jurisdictionType === "national" && (
            <label className="text-sm font-medium text-[#5f5f64]">
              Land
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value === "LI" ? "LI" : e.target.value === "all" ? "all" : "CH")}
                className={`${inputCls} mt-1 appearance-none`}
              >
                <option value="CH">Schweiz</option>
                <option value="LI">Liechtenstein</option>
                <option value="all">Alle Länder (z. B. SIA, VKF)</option>
              </select>
            </label>
          )}

          {jurisdictionType === "cantonal" && (
            <label className="text-sm font-medium text-[#5f5f64]">
              Kanton
              <select value={canton} onChange={(e) => setCanton(e.target.value)} className={`${inputCls} mt-1 appearance-none`}>
                {CANTONS.map((c) => (
                  <option key={c} value={c}>
                    {c === "FL" ? "FL (Liechtenstein)" : c}
                  </option>
                ))}
              </select>
            </label>
          )}

          {jurisdictionType === "municipal" && (
            <label className="text-sm font-medium text-[#5f5f64]">
              Gemeinde <span className="text-[#a3201a]">*</span>
              <input
                type="text"
                required
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
                placeholder="z. B. Mels"
                className={`${inputCls} mt-1`}
              />
            </label>
          )}

          <label className="text-sm font-medium text-[#5f5f64]">
            Kategorie <span className="text-[#a3201a]">*</span>
            <input
              type="text"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="z. B. Grenzabstand, Gebäudehöhe"
              className={`${inputCls} mt-1`}
            />
          </label>

          <label className="text-sm font-medium text-[#5f5f64]">
            Zone (optional)
            <input type="text" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="z. B. W2" className={`${inputCls} mt-1`} />
          </label>

          <label className="text-sm font-medium text-[#5f5f64]">
            Quelle (optional)
            <input
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="z. B. SIA 500"
              className={`${inputCls} mt-1`}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg border border-[#D87979]/20 bg-[#fde7e5] px-3 py-2 text-sm text-[#a3201a] sm:col-span-2">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="rounded-lg border border-[#65A88A]/20 bg-[#e4f3ea] px-3 py-2 text-sm text-[#136a40] sm:col-span-2">
              {success}
            </p>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={uploading || !file}
              className="rounded-lg bg-[#151414] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2e2e30] disabled:opacity-50"
            >
              {uploading ? "Wird verarbeitet…" : "Plattformweit hochladen"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
