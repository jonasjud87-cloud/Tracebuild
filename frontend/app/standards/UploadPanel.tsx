"use client";

import { useCallback, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ChevronDownIcon } from "@/components/dashboard/icons";
import { CANTON_NAMES } from "@/lib/norm-groups";
import { UploadIcon } from "./icons";
import s from "./standards.module.css";

export type UploadMode = "company" | "law";

const CANTONS = Object.keys(CANTON_NAMES);

const JURISDICTIONS = [
  { value: "national", label: "Bund" },
  { value: "cantonal", label: "Kanton" },
  { value: "municipal", label: "Gemeinde" },
] as const;

interface Props {
  mode: UploadMode;
  onClose: () => void;
  onUploaded: () => void;
}

export default function UploadPanel({ mode, onClose, onUploaded }: Props) {
  const uid = useId();
  const company = mode === "company";
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
    if (!company && jurisdictionType === "municipal" && !municipality.trim()) {
      setError("Bitte eine Gemeinde eingeben.");
      return;
    }
    setError(null);
    setSuccess(null);
    setUploading(true);
    try {
      const type = company ? "org" : jurisdictionType;
      const jurisdictionName = company || type === "national" ? "" : type === "municipal" ? municipality.trim() : canton;
      const form = new FormData();
      form.append("file", file);
      form.append("domain", "bau");
      form.append("jurisdiction_type", type);
      form.append("jurisdiction_name", jurisdictionName);
      form.append("category", category.trim());
      form.append("source_name", sourceName.trim());
      form.append("zone", zone.trim());
      const result = await api.postForm<{ count: number; jurisdiction_name: string; category: string }>("/standards/upload", form);
      setSuccess(`Gespeichert: ${result.category}${company ? ", gilt für alle Projekte Ihrer Organisation" : ""}`);
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
    <section id={`${uid}-upload`} className={`${s.upload} ${s.glass}`} aria-labelledby={`${uid}-upload-title`}>
      <div className={s.uploadHead}>
        <h2 id={`${uid}-upload-title`} className={s.uploadTitle}>
          {company ? "Unternehmensnorm hochladen" : "Eigene Fassung hochladen"}
        </h2>
        <button type="button" onClick={onClose} className={s.iconBtn} aria-label="Einklappen" title="Einklappen">
          <span style={{ display: "flex", transform: "rotate(180deg)" }}>
            <ChevronDownIcon size={20} />
          </span>
        </button>
      </div>
      <form onSubmit={handleUpload}>
        <div className={s.uploadGrid}>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt"
              className={s.sr}
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`${s.drop} ${dragOver ? s.dropOver : ""}`}
              style={{ width: "100%", height: "100%" }}
            >
              <span className={s.dropIcon}>
                <UploadIcon size={30} />
              </span>
              {file ? (
                <span className={s.dropFile}>{file.name}</span>
              ) : (
                <>
                  <span className={s.dropMain}>PDF / TXT</span>
                  <span className={s.dropSub}>Drag & Drop oder klicken</span>
                </>
              )}
            </button>
          </div>

          <div className={s.fields}>
            {!company && (
              <div>
                <label htmlFor={`${uid}-level`} className={s.label}>
                  Ebene
                </label>
                <select
                  id={`${uid}-level`}
                  value={jurisdictionType}
                  onChange={(e) => setJurisdictionType(e.target.value as typeof jurisdictionType)}
                  className={s.input}
                >
                  {JURISDICTIONS.map((j) => (
                    <option key={j.value} value={j.value}>
                      {j.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!company && jurisdictionType === "cantonal" && (
              <div>
                <label htmlFor={`${uid}-up-canton`} className={s.label}>
                  Kanton
                </label>
                <select id={`${uid}-up-canton`} value={canton} onChange={(e) => setCanton(e.target.value)} className={s.input}>
                  {CANTONS.map((c) => (
                    <option key={c} value={c}>
                      {c === "FL" ? "FL (Liechtenstein)" : c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!company && jurisdictionType === "municipal" && (
              <div>
                <label htmlFor={`${uid}-muni`} className={s.label}>
                  Gemeinde{" "}
                  <span className={s.req} aria-hidden="true">
                    *
                  </span>
                </label>
                <input
                  id={`${uid}-muni`}
                  type="text"
                  required
                  value={municipality}
                  onChange={(e) => setMunicipality(e.target.value)}
                  placeholder="z. B. Mels"
                  className={s.input}
                />
              </div>
            )}

            <div className={company || jurisdictionType === "national" ? undefined : s.fieldFull}>
              <label htmlFor={`${uid}-category`} className={s.label}>
                Kategorie{" "}
                <span className={s.req} aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id={`${uid}-category`}
                type="text"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={company ? "z. B. Brandschutz, Ausführung, Qualität" : "z. B. Grenzabstand, Gebäudehöhe"}
                className={s.input}
              />
            </div>

            <div>
              <label htmlFor={`${uid}-source`} className={s.label}>
                {company ? "Bezeichnung (optional)" : "Quelle (optional)"}
              </label>
              <input
                id={`${uid}-source`}
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder={company ? "z. B. Brandschutzrichtlinie 2026" : "z. B. PBG ZH § 270"}
                className={s.input}
              />
            </div>

            <div>
              <label htmlFor={`${uid}-zone`} className={s.label}>
                Zone (optional)
              </label>
              <input
                id={`${uid}-zone`}
                type="text"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="z. B. W2, leer = gilt für alle Zonen"
                className={s.input}
              />
            </div>

            {error && (
              <p role="alert" className={`${s.notice} ${s.noticeErr} ${s.fieldFull}`}>
                {error}
              </p>
            )}
            {success && (
              <p role="status" className={`${s.notice} ${s.noticeOk} ${s.fieldFull}`}>
                {success}
              </p>
            )}

            <div className={s.fieldFull}>
              <button type="submit" disabled={uploading || !file} className={s.btnSand}>
                {uploading ? "Wird verarbeitet…" : "Hochladen & speichern"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
