"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { ExtractStatus, ParcelCandidate, ProjectRefreshInfo } from "@/lib/geoadmin/contract";
import ParcelSearch, { CandidateList } from "@/components/ParcelSearch";
import ProjectGeoPanel from "@/components/ProjectGeoPanel";
import OerebStatusNotice from "@/components/OerebStatusNotice";
import { useOerebSync } from "@/components/useOerebDocumentSync";
import { candidateLabel, candidateToFields, sortCandidates, zoneNeedsAttention, zoneOriginLabel, type ParcelFields } from "@/components/geoportal-logic";

interface Project {
  id: string;
  name: string;
  domain: string;
  location: { canton: string; municipality: string; country?: string };
  status: string;
  parcel_number: string | null;
  bauzone: string | null;
  zone_source?: "oereb" | "manual" | null;
  zone_confidence?: "exact" | "coarse" | "low" | null;
  egrid?: string | null;
}

interface PendingParcel { fields: ParcelFields; label: string }

function zoneBadgeClass(p: Project | null): string {
  if (p?.zone_source === "manual") return "bg-[rgba(133,166,233,0.1)] text-[#ABAEBB]";
  if (p?.zone_confidence === "low" || p?.zone_confidence === "coarse") return "bg-amber-500/10 text-amber-400";
  return "bg-orange-500/10 text-orange-400";
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
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingParcel, setPendingParcel] = useState<PendingParcel | null>(null);
  const [savingParcel, setSavingParcel] = useState(false);
  const [parcelError, setParcelError] = useState<string | null>(null);
  const [extractStatus, setExtractStatus] = useState<{ status: ExtractStatus; detail: string | null; pdf: string | null } | null>(null);
  const [candidates, setCandidates] = useState<ParcelCandidate[] | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesAttempt, setCandidatesAttempt] = useState(0);
  const [panelKey, setPanelKey] = useState(0);
  const sync = useOerebSync();

  const isAdmin = role === "org_admin" || role === "super_admin";

  function applyProject(p: Project) {
    setProject(p);
    setName(p.name);
    setCanton(p.location?.canton ?? "ZH");
    setMunicipality(p.location?.municipality ?? "");
    setParcelNumber(p.parcel_number ?? "");
    setBauzone(p.bauzone ?? "");
  }

  useEffect(() => {
    api.get<Project>(`/projects/${params.id}`).then((p) => {
      applyProject(p);
      setLoading(false);
    });
  }, [params.id]);

  // Mehrdeutiges Grundstück (auch Bestandsprojekte): Die Kandidaten liefert nur der POST, nicht
  // das GET. Der POST löst einen Abruf aus, deshalb nur für Admins, die wählen dürfen.
  useEffect(() => {
    if (roleLoading) return;
    let cancelled = false;
    (async () => {
      const view = await api
        .get<{ extract: { status: ExtractStatus | null; status_detail: string | null } | null; oereb_pdf_url?: string | null }>(`/projects/${params.id}/oereb`)
        .catch(() => null);
      if (cancelled || !view?.extract?.status) return;
      setExtractStatus({ status: view.extract.status, detail: view.extract.status_detail, pdf: view.oereb_pdf_url ?? null });
      if (view.extract.status !== "ambiguous" || !isAdmin) return;
      setCandidatesLoading(true);
      const res = await api
        .post<{ candidates?: ParcelCandidate[] }>(`/projects/${params.id}/oereb`, { force: true })
        .catch(() => null);
      if (cancelled) return;
      setCandidates(res?.candidates?.length ? sortCandidates(res.candidates) : []);
      setCandidatesLoading(false);
    })();
    return () => { cancelled = true; };
  // Genau ein Versuch je Öffnen oder Klick: Innerhalb von 30 s nach dem letzten Abruf antwortet der
  // Server mit 200 und `fetched: false`, also ohne Kandidaten.
  // Bleiben die Kandidaten aus, zeigt die Seite «Auswahl erneut abfragen» statt selbst zu wiederholen.
  }, [params.id, isAdmin, roleLoading, candidatesAttempt]);

  useEffect(() => {
    fetch("/api/v1/auth/me").then(async (res) => {
      if (res.ok) {
        const json = await res.json() as { data: { role: string } };
        setRole(json.data.role);
      }
      setRoleLoading(false);
    }).catch(() => setRoleLoading(false));
  }, []);

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
      // Angezeigt wird die Antwort des Servers, nicht das Abgeschickte.
      const zoneChanged = newZone !== (project?.bauzone ?? null);
      const updated = await api.patch<Project & Partial<ProjectRefreshInfo>>(`/projects/${params.id}`, {
        name,
        location: { canton, municipality, country: project?.location?.country ?? "CH" },
        parcel_number: parcelNumber.trim() || null,
        ...(zoneChanged ? { bauzone: newZone } : {}),
      });
      if (updated) {
        setProject((prev) => (prev ? { ...prev, ...updated } : updated));
        setBauzone(updated.bauzone ?? "");
      }
      if (updated?.oereb) {
        setExtractStatus({ status: updated.oereb.status, detail: updated.oereb.status_detail, pdf: null });
        setCandidates(updated.oereb.status === "ambiguous" ? sortCandidates(updated.oereb.candidates ?? []) : null);
        setPanelKey((k) => k + 1);
      }
      if (updated?.documents_pending) sync.run(updated.documents_pending);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  /** Grundstück aus Suche oder Mehrfachtreffer übernehmen. Die Route holt den Auszug neu. */
  async function saveParcel(parcel: PendingParcel) {
    const { fields } = parcel;
    // Nie eine neue EGRID mit altem Kanton oder alter Gemeinde speichern.
    if (!fields.canton || !fields.municipality) {
      setParcelError("Zu diesem Grundstück fehlen Kanton oder Gemeinde. Es wurde nichts gespeichert. Bitte später erneut versuchen.");
      return;
    }
    setSavingParcel(true);
    setParcelError(null);
    try {
      const updated = await api.patch<Project & ProjectRefreshInfo>(`/projects/${params.id}`, {
        location: {
          canton: fields.canton,
          municipality: fields.municipality,
          country: project?.location?.country ?? "CH",
        },
        parcel_number: fields.parcelNumber,
        ...fields.identity,
      });
      applyProject(updated);
      setPendingParcel(null);
      setCandidates(null);
      setExtractStatus(updated.oereb
        ? { status: updated.oereb.status, detail: updated.oereb.status_detail, pdf: null }
        : null);
      if (updated.oereb?.status === "ambiguous" && updated.oereb.candidates?.length) {
        setCandidates(sortCandidates(updated.oereb.candidates));
      }
      setPanelKey((k) => k + 1);
      if (updated.documents_pending > 0) sync.run(updated.documents_pending);
    } catch (err: unknown) {
      setParcelError(err instanceof Error ? err.message : "Die Parzelle konnte nicht gespeichert werden.");
    } finally {
      setSavingParcel(false);
    }
  }

  /** Unsichere Zone so übernehmen, wie sie ist: Sie gilt danach als manuell bestätigt. */
  async function confirmZone() {
    if (!project?.bauzone) return;
    setError(null);
    try {
      const updated = await api.patch<Project>(`/projects/${params.id}`, { bauzone: project.bauzone });
      setProject({ ...project, ...updated });
      setBauzone(updated.bauzone ?? "");
      setPanelKey((k) => k + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Die Zone konnte nicht bestätigt werden.");
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

  if (loading || roleLoading) {
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

  if (!isAdmin) {
    return (
      <div className="max-w-xl">
        <h2 className="text-base font-semibold text-white mb-6">Projekteinstellungen</h2>

        <p className="text-xs text-[#7B8299] bg-[rgba(133,166,233,0.08)] border border-[rgba(133,166,233,0.25)] rounded-lg px-3 py-2 mb-4">
          Nur Organisations-Admins können die Projekteinstellungen bearbeiten.
        </p>

        <ProjectGeoPanel key={panelKey} projectId={params.id} defaultOpen />

        <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#7B8299] mb-1">Projektname</label>
            <div className={inputCls}>{project?.name}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#7B8299] mb-1">Kanton</label>
              <div className={inputCls}>{project?.location?.canton ?? "–"}</div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#7B8299] mb-1">Gemeinde</label>
              <div className={inputCls}>{project?.location?.municipality ?? "–"}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#7B8299] mb-1">Parzellennummer</label>
              <div className={inputCls}>{project?.parcel_number ?? "–"}</div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#7B8299] mb-1">
                Bauzone
                {zoneOriginLabel(project) && (
                  <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${zoneBadgeClass(project)}`}>
                    {zoneOriginLabel(project)}
                  </span>
                )}
              </label>
              <div className={inputCls}>{project?.bauzone || "–"}</div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#7B8299] mb-1">Domain</label>
            <div className="border border-[rgba(60,63,68,0.5)] rounded-lg px-3 py-2 text-sm bg-[rgba(60,63,68,0.3)] text-[#7B8299]">
              Bau / Architektur
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-semibold text-white mb-6">Projekteinstellungen</h2>

      <ProjectGeoPanel key={panelKey} projectId={params.id} showZoneEditor={false} defaultOpen onChanged={() => {
        api.get<Project>(`/projects/${params.id}`).then((p) => { setProject(p); setBauzone(p.bauzone ?? ""); }).catch(() => {});
      }} />

      <section id="parzelle" className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-xl p-5 mb-4 space-y-3" style={{ scrollMarginTop: 110 }}>
        <div>
          <h3 className="text-sm font-medium text-white mb-1">Parzelle wählen</h3>
          <p className="text-xs text-[#7B8299] leading-snug">
            {project?.egrid
              ? `Aktuell: Grundstück ${project.egrid}. Eine neue Wahl ersetzt Auszug und Zusatzdaten; eine manuell gesetzte Zone bleibt.`
              : "Dieses Projekt ist noch nicht eindeutig einem Grundstück zugeordnet. Mit der Suche holen Sie das nach."}
          </p>
        </div>

        {candidatesLoading && <p role="status" className="text-xs text-[#7B8299]">Grundstücke werden abgefragt…</p>}
        {extractStatus?.status === "ambiguous" && candidates && candidates.length > 0 && (
          <div role="group" aria-label="Grundstück wählen">
            <p className="text-xs font-medium text-amber-400 mb-2">Mehrere Grundstücke passen. Welches ist gemeint?</p>
            <CandidateList
              candidates={candidates}
              disabled={savingParcel}
              onPick={(c) => saveParcel({ fields: candidateToFields(c), label: candidateLabel(c) })}
            />
          </div>
        )}
        {extractStatus?.status === "ambiguous" && candidates && candidates.length === 0 && (
          <div>
            <p className="text-xs text-amber-400">Mehrere Grundstücke passen, die Auswahl ist gerade nicht abrufbar. Der letzte Abruf liegt vielleicht weniger als 30 Sekunden zurück. Bitte in einer halben Minute erneut abfragen oder die Suche verwenden.</p>
            <button type="button" onClick={() => { setCandidates(null); setCandidatesAttempt((n) => n + 1); }} className="mt-1 text-xs font-medium text-[#85A6E9] hover:text-white transition-colors">
              Auswahl erneut abfragen
            </button>
          </div>
        )}
        {extractStatus && extractStatus.status !== "ok" && extractStatus.status !== "ambiguous" && (
          <OerebStatusNotice status={extractStatus.status} canton={project?.location?.canton} detail={extractStatus.detail} pdfUrl={extractStatus.pdf} projectId={params.id} isAdmin hideChoose />
        )}

        <ParcelSearch requireComplete onSelect={(selection) => { setParcelError(null); setPendingParcel({ fields: selection.fields, label: selection.label }); }} />

        {pendingParcel && (
          <div className="rounded-lg border border-[rgba(133,166,233,0.25)] px-3 py-2 space-y-2">
            <p className="text-xs text-[#ABAEBB] break-words">
              Gewählt: <span className="text-white font-medium">{pendingParcel.label}</span>
              {pendingParcel.fields.identity.egrid ? ` (${pendingParcel.fields.identity.egrid})` : ""}
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                disabled={savingParcel}
                onClick={() => saveParcel(pendingParcel)}
                className="bg-[#2862D7] hover:bg-[#3470E8] text-white py-1.5 px-3 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {savingParcel ? "ÖREB-Auszug wird abgerufen…" : "Diese Parzelle übernehmen"}
              </button>
              <button
                type="button"
                disabled={savingParcel}
                onClick={() => setPendingParcel(null)}
                className="text-[#ABAEBB] border border-[rgba(133,166,233,0.25)] py-1.5 px-3 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                Verwerfen
              </button>
            </div>
          </div>
        )}
        {savingParcel && !pendingParcel && <p role="status" className="text-xs text-[#7B8299]">ÖREB-Auszug wird abgerufen…</p>}
        {parcelError && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{parcelError}</p>}
      </section>

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
            {project?.egrid && (parcelNumber.trim() !== (project.parcel_number ?? "") || municipality !== (project.location?.municipality ?? "") || canton !== (project.location?.canton ?? "")) && (
              <p className="text-[11px] text-amber-400 mt-1 leading-snug">
                Beim Speichern gilt das Grundstück {project.egrid} nicht mehr. TraceBuild sucht es anhand Ihrer Angaben.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-[#7B8299] mb-1">
              Bauzone
              {zoneOriginLabel(project) && (
                <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${zoneBadgeClass(project)}`}>
                  {zoneOriginLabel(project)}
                </span>
              )}
            </label>
            <input
              type="text"
              value={bauzone}
              onChange={(e) => setBauzone(e.target.value)}
              placeholder="z.B. W2"
              className={`${inputCls} ${zoneNeedsAttention(project) ? "!border-amber-400/60" : ""}`}
            />
            <p className={`text-[11px] mt-1 leading-snug ${zoneNeedsAttention(project) ? "text-amber-400" : "text-[#7B8299]"}`}>
              {zoneNeedsAttention(project)
                ? project?.bauzone
                  ? "Der ÖREB-Auszug lässt keinen sicheren Schluss zu. Bitte bestätigen oder korrigieren."
                  : "Keine sichere Zone aus dem ÖREB-Kataster. Bitte von Hand eintragen."
                : project?.zone_source === "oereb"
                  ? "Automatisch aus dem ÖREB-Kataster. Eine Änderung hier gilt als manuelle Zone und überschreibt den Auszug."
                  : "Eine hier gesetzte Zone gilt als manuell und hat Vorrang vor dem ÖREB-Auszug."}
            </p>
            {zoneNeedsAttention(project) && project?.bauzone && bauzone.trim() === project.bauzone && (
              <button type="button" onClick={confirmZone} className="mt-1 text-xs font-medium text-[#85A6E9] hover:text-white transition-colors">
                Vorschlag bestätigen
              </button>
            )}
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
