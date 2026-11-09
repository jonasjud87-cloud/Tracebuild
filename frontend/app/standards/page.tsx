"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import LogoutButton from "@/components/LogoutButton";
import { createClient } from "@/lib/supabase/client";
import { jakarta } from "@/lib/fonts";
import { authoritativeErrorText, formatDate, safeExternalUrl, similarityPercent } from "@/components/geoportal-logic";
import type { NormSupersession } from "@/lib/geoadmin/contract";
import { CalendarIcon, ChevronDownIcon, GridIcon, LayersIcon, PinIcon, SearchIcon } from "@/components/dashboard/icons";
import { EyeIcon, EyeOffIcon, FileIcon, GlobeIcon, PlusIcon, TrashIcon, UploadIcon } from "./icons";
import s from "./standards.module.css";

interface FileEntry {
  ids: string[];
  title?: string;
  jurisdiction_name: string | null;
  jurisdiction_type: string;
  category: string;
  source_url: string | null;
  zone: string | null;
  pdf_url: string | null;
  global: boolean;
  createdAt: string | null;
  supersession: NormSupersession | null;
}

function VersionHint({ info, onChange }: {
  info: NormSupersession;
  onChange: (authoritative: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(authoritative: boolean) {
    if (authoritative && !confirm("Ihre Fassung als massgebend festlegen? Die Projekte Ihrer Organisation verwenden dann Ihren Upload statt des amtlichen Texts.")) return;
    setBusy(true);
    setProblem(null);
    try {
      await onChange(authoritative);
    } catch (e) {
      setProblem(authoritativeErrorText(e instanceof ApiError ? e.status : undefined));
    } finally {
      setBusy(false);
    }
  }

  const authoritative = info.version_hint === "org_authoritative";
  const officialUrl = safeExternalUrl(info.official?.source_url);
  const percent = similarityPercent(info.superseded_similarity);
  const since = formatDate(info.superseded_at);

  return (
    <div className={`${s.hint} ${authoritative ? s.hintOk : s.hintInfo}`}>
      <p className={s.hintTitle}>
        {authoritative ? "Ihre Fassung ist massgebend" : "Neuere amtliche Fassung verwendet"}
      </p>
      <p className={s.hintText}>
        {authoritative
          ? "Die Projekte Ihrer Organisation verwenden diesen Upload, auch wenn ein ähnlicher amtlicher Text vorliegt."
          : `Die Projekte verwenden den amtlichen Text. Ihr Upload bleibt gespeichert, zählt aber nicht mehr in der Analyse.${percent !== null ? ` ${percent} % davon stehen im amtlichen Text.` : ""}${since ? ` Stand ${since}.` : ""}`}
      </p>
      {info.official && (
        <p className={s.hintText}>
          Amtlich:{" "}
          {officialUrl ? (
            <a href={officialUrl} target="_blank" rel="noreferrer" className={s.hintLink}>
              {info.official.title} <span aria-hidden="true">↗</span>
            </a>
          ) : info.official.title}
        </p>
      )}
      <div className={s.hintAction}>
        <button type="button" disabled={busy} onClick={() => run(!authoritative)} className={s.btnGhost}>
          {busy ? "Wird gespeichert…" : authoritative ? "Festlegung zurücknehmen" : "Meine Fassung als massgebend festlegen"}
        </button>
      </div>
      {problem && <p role="alert" className={`${s.notice} ${s.noticeErr}`} style={{ marginTop: 8 }}>{problem}</p>}
    </div>
  );
}

function FileCard({ entry, onDelete, onAuthoritative }: {
  entry: FileEntry;
  onDelete: (ids: string[]) => void;
  onAuthoritative: (ids: string[], authoritative: boolean) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const detailId = useId();
  useEffect(() => {
    if (!expanded || text !== null) return;
    let active = true;
    Promise.all(entry.ids.map((id) => api.get<{ text: string }>(`/standards/${id}`)))
      .then((rows) => { if (active) setText(rows.map((r) => r.text).join("\n\n")); })
      .catch(() => { if (active) setText("Text konnte nicht geladen werden. Bitte später erneut versuchen."); });
    return () => { active = false; };
  }, [expanded, text, entry.ids]);
  const label = entry.source_url || entry.category;
  const date = formatDate(entry.createdAt);
  return (
    <li className={s.row}>
      <div className={s.rowMain}>
        <span className={s.fileIcon} aria-hidden="true"><FileIcon size={22} /></span>
        <div className={s.chips}>
          {entry.global && (
            <span className={`${s.chip} ${s.chipGlobal}`} title="Von TraceBuild für alle Organisationen hinterlegt">
              Global
            </span>
          )}
          <span className={`${s.chip} ${s.chipLevel}`}>{entry.jurisdiction_name ?? "—"}</span>
          <span className={`${s.chip} ${s.chipCat}`}>{entry.category}</span>
        </div>
        <span className={s.name}>{entry.source_url || "—"}</span>
        <span className={s.date}>
          <CalendarIcon size={18} />
          <span className={s.sr}>Hochgeladen am </span>
          <span>{date ?? "–"}</span>
        </span>
        <div className={s.actions}>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className={s.iconBtn}
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={`${expanded ? "Inhalt verbergen" : "Inhalt anzeigen"}: ${label}`}
            title={expanded ? "Inhalt verbergen" : "Inhalt anzeigen"}
          >
            {expanded ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          {!entry.global && (
            <button
              type="button"
              onClick={() => onDelete(entry.ids)}
              className={`${s.iconBtn} ${s.dangerBtn}`}
              aria-label={`Löschen: ${label}`}
              title="Löschen"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
      {entry.supersession && (
        <VersionHint info={entry.supersession} onChange={(value) => onAuthoritative(entry.ids, value)} />
      )}
      <div id={detailId} hidden={!expanded}>
        {expanded && (
          <div className={s.detail}>
            <p className={s.detailText}>{text ?? "Text wird geladen …"}</p>
            {entry.pdf_url && (
              <div>
                <iframe
                  src={entry.pdf_url}
                  className={s.pdfFrame}
                  title={`PDF-Vorschau ${entry.source_url ?? entry.category}`}
                />
                <a href={entry.pdf_url} target="_blank" rel="noreferrer" className={s.pdfLink}>
                  Original-PDF öffnen ↗
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

const CANTONS = [
  "AG","AI","AR","BE","BL","BS","FR","GE","GL","GR",
  "JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG",
  "TI","UR","VD","VS","ZG","ZH",
];

interface Standard extends Partial<NormSupersession> {
  id: string;
  title?: string;
  domain: string;
  layer: number;
  jurisdiction_type: string;
  jurisdiction_name: string | null;
  category: string;
  source_url: string | null;
  zone?: string | null;
  pdf_url?: string | null;
  org_id: string | null;
  created_at?: string | null;
}

const STANDARDS_PAGE_SIZE = 200;

function supersessionFrom(st: Standard): NormSupersession | null {
  if (!st.org_id || !st.version_hint) return null;
  return {
    version_hint: st.version_hint,
    org_authoritative: st.org_authoritative === true,
    superseded_similarity: st.superseded_similarity ?? null,
    superseded_at: st.superseded_at ?? null,
    official: st.official ?? null,
  };
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
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const uid = useId();

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
      const all: Standard[] = [];
      for (let offset = 0; ; offset += STANDARDS_PAGE_SIZE) {
        params.set("limit", String(STANDARDS_PAGE_SIZE));
        params.set("offset", String(offset));
        const page = (await api.get<Standard[]>(`/standards?${params}`)) ?? [];
        all.push(...page);
        if (page.length < STANDARDS_PAGE_SIZE) break;
      }
      setStandards(all);
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
    setStandards((prev) => prev.filter((st) => !ids.includes(st.id)));
  }

  async function handleAuthoritative(ids: string[], authoritative: boolean) {
    for (const id of ids) {
      try {
        const info = await api.put<NormSupersession & { id: string }>(`/standards/${id}/authoritative`, { authoritative });
        setStandards((prev) => prev.map((st) => (st.id === id ? { ...st, ...info } : st)));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) void loadStandards();
        throw e;
      }
    }
  }

  const categories = Array.from(new Set(standards.map((st) => st.category))).sort();

  const allEntries = useMemo(() => {
    const entries: FileEntry[] = [];
    const seen = new Map<string, FileEntry>();
    for (const st of standards) {
      const key = `${st.org_id ?? "global"}||${st.source_url ?? st.id}||${st.jurisdiction_name ?? ""}||${st.category}`;
      if (seen.has(key)) {
        const entry = seen.get(key)!;
        entry.ids.push(st.id);
        if (!entry.pdf_url && st.pdf_url) entry.pdf_url = st.pdf_url;
        if (!entry.supersession) entry.supersession = supersessionFrom(st);
      } else {
        const entry: FileEntry = {
          ids: [st.id],
          title: st.title,
          jurisdiction_name: st.jurisdiction_name ?? (st.jurisdiction_type === "national" ? "Bund" : null),
          jurisdiction_type: st.jurisdiction_type,
          category: st.category,
          source_url: st.source_url,
          zone: st.zone ?? null,
          pdf_url: st.pdf_url ?? null,
          global: st.org_id === null,
          createdAt: st.created_at ?? null,
          supersession: supersessionFrom(st),
        };
        seen.set(key, entry);
        entries.push(entry);
      }
    }
    return entries;
  }, [standards]);

  const needle = query.trim().toLowerCase();
  const fileEntries = allEntries.filter((en) => {
    if (filterCategory && en.category !== filterCategory) return false;
    if (!needle) return true;
    return [en.title, en.source_url, en.category, en.jurisdiction_name].some((v) => v?.toLowerCase().includes(needle));
  });

  const levelCount = new Set(allEntries.map((en) => en.jurisdiction_type).filter((t) => JURISDICTIONS.some((j) => j.value === t))).size;
  const ownCount = allEntries.filter((en) => !en.global).length;
  const kpis = [
    { icon: <LayersIcon size={26} />, value: allEntries.length, label: "Norm-Dateien" },
    { icon: <GridIcon size={26} />, value: new Set(allEntries.map((en) => en.category)).size, label: "Kategorien" },
    { icon: <GlobeIcon size={26} />, value: levelCount, label: "Ebenen (Bund, Kanton, Gemeinde)" },
    { icon: <FileIcon size={26} />, value: ownCount, label: "Eigene Uploads" },
  ];

  const emptyFor = needle ? `„${query.trim()}“` : filterCategory || filterJurisdiction || "diese Auswahl";

  return (
    <div className={`${jakarta.variable} ${jakarta.className} ${s.shell}`}>
      <div className={s.hero}>
        <div className={s.backdrop} aria-hidden="true">
          <div className={s.photo} style={{ backgroundImage: "url(/landing/dashboard-building.jpg)" }} />
          <div className={s.shade} />
        </div>
        <div className={s.heroInner}>
          <header className={s.topbar}>
            <Link href="/dashboard" className={s.back}>
              <span aria-hidden="true">←</span> Dashboard
            </Link>
            <div className={s.userArea}>
              {email && (
                <div className={s.userPill}>
                  <span className={s.avatar} aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
                  <span className={s.email}>{email}</span>
                </div>
              )}
              <LogoutButton className={s.logout} />
            </div>
          </header>
          <h1 className={s.title}>Normen-Datenbank</h1>
          <p className={s.lead}>Zentrale Sammlung aller relevanten Normen, Gesetze und Regelwerke.</p>
        </div>
      </div>

      <div className={s.page}>
        <main>
          <ul className={s.kpis} aria-label="Kennzahlen">
            {kpis.map((k) => (
              <li key={k.label} className={`${s.kpi} ${s.glass}`}>
                <span className={s.iconBox} aria-hidden="true">{k.icon}</span>
                <div className={s.kpiText}>
                  <p className={s.kpiValue}>{loading ? "–" : k.value}</p>
                  <p className={s.kpiLabel}>{k.label}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className={s.toolbar}>
            <button
              type="button"
              onClick={() => setUploadOpen((o) => !o)}
              className={s.btnDark}
              aria-expanded={uploadOpen}
              aria-controls={`${uid}-upload`}
            >
              <PlusIcon size={20} />
              Norm hochladen
            </button>

            <div className={`${s.field} ${s.searchField}`}>
              <label htmlFor={`${uid}-search`} className={s.sr}>Normen, Gesetze oder Dokumente suchen</label>
              <SearchIcon size={20} />
              <input
                id={`${uid}-search`}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Normen, Gesetze oder Dokumente suchen…"
                autoComplete="off"
                className={s.bare}
              />
            </div>

            <div className={`${s.field} ${s.selectField}`}>
              <label htmlFor={`${uid}-canton`} className={s.sr}>Kanton filtern</label>
              <PinIcon size={20} />
              <select id={`${uid}-canton`} value={filterJurisdiction} onChange={(e) => setFilterJurisdiction(e.target.value)} className={s.bare}>
                <option value="">Alle Kantone</option>
                {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className={s.chev} aria-hidden="true"><ChevronDownIcon size={18} /></span>
            </div>

            <div className={`${s.field} ${s.selectField}`}>
              <label htmlFor={`${uid}-cat`} className={s.sr}>Kategorie filtern</label>
              <LayersIcon size={20} />
              <select id={`${uid}-cat`} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={s.bare} disabled={categories.length === 0}>
                <option value="">Alle Kategorien</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className={s.chev} aria-hidden="true"><ChevronDownIcon size={18} /></span>
            </div>
          </div>

          {uploadOpen && (
            <section id={`${uid}-upload`} className={`${s.upload} ${s.glass}`} aria-labelledby={`${uid}-upload-title`}>
              <div className={s.uploadHead}>
                <h2 id={`${uid}-upload-title`} className={s.uploadTitle}>Norm hochladen</h2>
                <button type="button" onClick={() => setUploadOpen(false)} className={s.iconBtn} aria-label="Einklappen" title="Einklappen">
                  <span style={{ display: "flex", transform: "rotate(180deg)" }}><ChevronDownIcon size={20} /></span>
                </button>
              </div>
              <form onSubmit={handleUpload}>
                <div className={s.uploadGrid}>
                  <div>
                    <input ref={fileRef} type="file" accept=".pdf,.txt" className={s.sr} tabIndex={-1} aria-hidden="true"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                    <button
                      type="button"
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => fileRef.current?.click()}
                      className={`${s.drop} ${dragOver ? s.dropOver : ""}`}
                      style={{ width: "100%", height: "100%" }}
                    >
                      <span className={s.dropIcon}><UploadIcon size={30} /></span>
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
                    <div>
                      <label htmlFor={`${uid}-level`} className={s.label}>Ebene</label>
                      <select id={`${uid}-level`} value={jurisdictionType} onChange={(e) => setJurisdictionType(e.target.value as "national" | "cantonal" | "municipal")} className={s.input}>
                        {JURISDICTIONS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
                      </select>
                    </div>

                    {jurisdictionType === "cantonal" && (
                      <div>
                        <label htmlFor={`${uid}-up-canton`} className={s.label}>Kanton</label>
                        <select id={`${uid}-up-canton`} value={canton} onChange={(e) => setCanton(e.target.value)} className={s.input}>
                          {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    )}

                    {jurisdictionType === "municipal" && (
                      <div>
                        <label htmlFor={`${uid}-muni`} className={s.label}>
                          Gemeinde <span className={s.req} aria-hidden="true">*</span>
                        </label>
                        <input id={`${uid}-muni`} type="text" required value={municipality} onChange={(e) => setMunicipality(e.target.value)}
                          placeholder="z.B. Mels" className={s.input} />
                      </div>
                    )}

                    <div className={jurisdictionType === "national" ? undefined : s.fieldFull}>
                      <label htmlFor={`${uid}-category`} className={s.label}>
                        Kategorie <span className={s.req} aria-hidden="true">*</span>
                      </label>
                      <input id={`${uid}-category`} type="text" required value={category} onChange={(e) => setCategory(e.target.value)}
                        placeholder="z.B. Grenzabstand, Gebäudehöhe" className={s.input} />
                    </div>

                    <div>
                      <label htmlFor={`${uid}-zone`} className={s.label}>Zone (optional)</label>
                      <input id={`${uid}-zone`} type="text" value={zone} onChange={(e) => setZone(e.target.value)}
                        placeholder="z.B. W2 — leer = gilt für alle Zonen" className={s.input} />
                    </div>

                    <div>
                      <label htmlFor={`${uid}-source`} className={s.label}>Quelle (optional)</label>
                      <input id={`${uid}-source`} type="text" value={sourceName} onChange={(e) => setSourceName(e.target.value)}
                        placeholder="z.B. PBG ZH § 270" className={s.input} />
                    </div>

                    {error && <p role="alert" className={`${s.notice} ${s.noticeErr} ${s.fieldFull}`}>{error}</p>}
                    {success && <p role="status" className={`${s.notice} ${s.noticeOk} ${s.fieldFull}`}>{success}</p>}

                    <div className={s.fieldFull}>
                      <button type="submit" disabled={uploading || !file} className={s.btnSand}>
                        {uploading ? "Wird verarbeitet…" : "Hochladen & speichern"}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </section>
          )}

          <h2 className={s.listHead}>
            <span className={s.listTitle}>Hochgeladene Norm-Dateien</span>
            {fileEntries.length > 0 && (
              <span className={s.count}>
                ({fileEntries.length} {fileEntries.length === 1 ? "Datei" : "Dateien"})
              </span>
            )}
          </h2>

          {loading ? (
            <ul className={s.list} aria-busy="true" aria-label="Normen werden geladen">
              {[...Array(5)].map((_, i) => (
                <li key={i} className={s.skel}>
                  <span className={s.skelBar} style={{ width: "28%" }} />
                  <span className={s.skelBar} style={{ width: "62%" }} />
                </li>
              ))}
            </ul>
          ) : allEntries.length === 0 ? (
            <div className={`${s.empty} ${s.glass}`}>
              <p className={s.emptyMain}>Noch keine Normen vorhanden.</p>
              <p className={s.emptySub}>Lade eine PDF- oder Textdatei hoch.</p>
            </div>
          ) : fileEntries.length === 0 ? (
            <div className={`${s.empty} ${s.glass}`} role="status">
              <p className={s.emptyMain}>Keine Normen für {emptyFor}.</p>
              <p className={s.emptySub}>Suche oder Filter anpassen.</p>
            </div>
          ) : (
            <ul className={s.list}>
              {fileEntries.map((entry) => (
                <FileCard key={entry.ids[0]} entry={entry} onDelete={handleDelete} onAuthoritative={handleAuthoritative} />
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  );
}
