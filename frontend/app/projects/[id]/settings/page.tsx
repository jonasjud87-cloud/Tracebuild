"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { ExtractStatus, ParcelCandidate, ProjectRefreshInfo } from "@/lib/geoadmin/contract";
import ParcelSearch, { CandidateList } from "@/components/ParcelSearch";
import ProjectGeoPanel from "@/components/ProjectGeoPanel";
import OerebStatusNotice from "@/components/OerebStatusNotice";
import ProjectBanner from "@/components/project/ProjectBanner";
import { useOerebSync } from "@/components/useOerebDocumentSync";
import { candidateLabel, candidateToFields, sortCandidates, zoneNeedsAttention, zoneOriginLabel, type ParcelFields } from "@/components/geoportal-logic";
import p from "@/app/projects/project.module.css";
import s from "./settings.module.css";

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

function zoneBadgeClass(pr: Project | null): string {
  if (pr?.zone_source === "manual") return p.chip;
  if (pr?.zone_confidence === "low" || pr?.zone_confidence === "coarse") return p.chipWarn;
  return p.chipInfo;
}

const CANTONS = [
  "AG","AI","AR","BE","BL","BS","FR","GE","GL","GR",
  "JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG",
  "TI","UR","VD","VS","ZG","ZH",
];

const FORM_ID = "project-settings-form";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function CardHead({ icon, title, text }: { icon: React.ReactNode; title: string; text?: string }) {
  return (
    <div className={s.cardHead}>
      <span className={`${p.iconTile} ${s.tile}`}>{icon}</span>
      <div>
        <h2 className={s.cardTitle}>{title}</h2>
        {text && <p className={s.cardText}>{text}</p>}
      </div>
    </div>
  );
}

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

  function applyProject(pr: Project) {
    setProject(pr);
    setName(pr.name);
    setCanton(pr.location?.canton ?? "ZH");
    setMunicipality(pr.location?.municipality ?? "");
    setParcelNumber(pr.parcel_number ?? "");
    setBauzone(pr.bauzone ?? "");
  }

  useEffect(() => {
    api.get<Project>(`/projects/${params.id}`).then((pr) => {
      applyProject(pr);
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

  const subtitle = project
    ? [project.name, [project.location?.municipality, project.location?.canton].filter(Boolean).join(" ")].filter(Boolean).join(" · ")
    : undefined;

  if (loading || roleLoading) {
    return (
      <>
        <ProjectBanner title="Einstellungen" />
        <div className={s.stack} role="status" aria-label="Einstellungen werden geladen">
          <div className={`${p.glassFlat} ${p.card} ${s.skelCard}`}>
            <span className={p.skeleton} style={{ width: "30%", height: 20 }} />
            <span className={p.skeleton} style={{ height: 44 }} />
            <span className={p.skeleton} style={{ height: 44 }} />
          </div>
          <div className={`${p.glassFlat} ${p.card} ${s.skelCard}`}>
            <span className={p.skeleton} style={{ width: "24%", height: 20 }} />
            <span className={p.skeleton} style={{ height: 44 }} />
          </div>
        </div>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <ProjectBanner title="Einstellungen" subtitle={subtitle} />

        <div className={s.stack}>
          <p className={s.notice}>
            Nur Organisations-Admins können die Projekteinstellungen bearbeiten.
          </p>

          <ProjectGeoPanel key={panelKey} projectId={params.id} defaultOpen />

          <section className={`${p.glass} ${p.card}`}>
            <CardHead
              icon={<Icon><rect x="4.5" y="3.5" width="15" height="17" rx="3" /><path d="M8 9h8M8 13h8M8 17h4" /></Icon>}
              title="Projektdaten"
            />
            <div className={s.fields}>
              <div>
                <span className={p.label}>Projektname</span>
                <div className={s.value}>{project?.name}</div>
              </div>

              <div className={s.grid2}>
                <div>
                  <span className={p.label}>Kanton</span>
                  <div className={s.value}>{project?.location?.canton ?? "–"}</div>
                </div>
                <div>
                  <span className={p.label}>Gemeinde</span>
                  <div className={s.value}>{project?.location?.municipality ?? "–"}</div>
                </div>
              </div>

              <div className={s.grid2}>
                <div>
                  <span className={p.label}>Parzellennummer</span>
                  <div className={s.value}>{project?.parcel_number ?? "–"}</div>
                </div>
                <div>
                  <span className={p.label}>
                    Bauzone
                    {zoneOriginLabel(project) && (
                      <span className={`${zoneBadgeClass(project)} ${s.chipSm}`}>
                        {zoneOriginLabel(project)}
                      </span>
                    )}
                  </span>
                  <div className={s.value}>{project?.bauzone || "–"}</div>
                </div>
              </div>

              <div>
                <span className={p.label}>Domain</span>
                <div className={`${s.value} ${s.valueMuted}`}>Bau / Architektur</div>
              </div>
            </div>
          </section>
        </div>
      </>
    );
  }

  const zoneAttention = zoneNeedsAttention(project);

  return (
    <>
      <ProjectBanner
        title="Einstellungen"
        subtitle={subtitle}
        actions={
          <button type="submit" form={FORM_ID} disabled={saving} className={p.btnSand}>
            {saving ? "Wird gespeichert…" : "Speichern"}
          </button>
        }
      />

      <div className={s.stack}>
        <ProjectGeoPanel key={panelKey} projectId={params.id} showZoneEditor={false} defaultOpen onChanged={() => {
          api.get<Project>(`/projects/${params.id}`).then((pr) => { setProject(pr); setBauzone(pr.bauzone ?? ""); }).catch(() => {});
        }} />

        <section id="parzelle" className={`${p.glass} ${p.card} ${s.anchor}`}>
          <CardHead
            icon={<Icon><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></Icon>}
            title="Parzelle wählen"
            text={project?.egrid
              ? `Aktuell: Grundstück ${project.egrid}. Eine neue Wahl ersetzt Auszug und Zusatzdaten; eine manuell gesetzte Zone bleibt.`
              : "Dieses Projekt ist noch nicht eindeutig einem Grundstück zugeordnet. Mit der Suche holen Sie das nach."}
          />

          <div className={s.fields}>
            {candidatesLoading && <p role="status" className={s.status}>Grundstücke werden abgefragt…</p>}
            {extractStatus?.status === "ambiguous" && candidates && candidates.length > 0 && (
              <div role="group" aria-label="Grundstück wählen">
                <p className={s.warnHead}>Mehrere Grundstücke passen. Welches ist gemeint?</p>
                <CandidateList
                  candidates={candidates}
                  disabled={savingParcel}
                  onPick={(c) => saveParcel({ fields: candidateToFields(c), label: candidateLabel(c) })}
                />
              </div>
            )}
            {extractStatus?.status === "ambiguous" && candidates && candidates.length === 0 && (
              <div>
                <p className={s.alertWarn}>Mehrere Grundstücke passen, die Auswahl ist gerade nicht abrufbar. Der letzte Abruf liegt vielleicht weniger als 30 Sekunden zurück. Bitte in einer halben Minute erneut abfragen oder die Suche verwenden.</p>
                <button type="button" onClick={() => { setCandidates(null); setCandidatesAttempt((n) => n + 1); }} className={`${p.btnGhost} ${p.btnSm}`} style={{ marginTop: 10 }}>
                  Auswahl erneut abfragen
                </button>
              </div>
            )}
            {extractStatus && extractStatus.status !== "ok" && extractStatus.status !== "ambiguous" && (
              <OerebStatusNotice status={extractStatus.status} canton={project?.location?.canton} detail={extractStatus.detail} pdfUrl={extractStatus.pdf} projectId={params.id} isAdmin hideChoose />
            )}

            <ParcelSearch requireComplete onSelect={(selection) => { setParcelError(null); setPendingParcel({ fields: selection.fields, label: selection.label }); }} />

            {pendingParcel && (
              <div className={s.picked}>
                <p className={s.pickedText}>
                  Gewählt: <strong>{pendingParcel.label}</strong>
                  {pendingParcel.fields.identity.egrid ? ` (${pendingParcel.fields.identity.egrid})` : ""}
                </p>
                <div className={s.actions}>
                  <button
                    type="button"
                    disabled={savingParcel}
                    onClick={() => saveParcel(pendingParcel)}
                    className={`${p.btnNavy} ${p.btnSm}`}
                  >
                    {savingParcel ? "ÖREB-Auszug wird abgerufen…" : "Diese Parzelle übernehmen"}
                  </button>
                  <button
                    type="button"
                    disabled={savingParcel}
                    onClick={() => setPendingParcel(null)}
                    className={`${p.btnGhost} ${p.btnSm}`}
                  >
                    Verwerfen
                  </button>
                </div>
              </div>
            )}
            {savingParcel && !pendingParcel && <p role="status" className={s.status}>ÖREB-Auszug wird abgerufen…</p>}
            {parcelError && <p role="alert" className={s.alertErr}>{parcelError}</p>}
          </div>
        </section>

        <form id={FORM_ID} onSubmit={handleSave} className={`${p.glass} ${p.card}`}>
          <CardHead
            icon={<Icon><rect x="4.5" y="3.5" width="15" height="17" rx="3" /><path d="M8 9h8M8 13h8M8 17h4" /></Icon>}
            title="Projektdaten"
          />

          <div className={s.fields}>
            <div>
              <label htmlFor="set-name" className={p.label}>Projektname</label>
              <input
                id="set-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={p.input}
              />
            </div>

            <div className={s.grid2}>
              <div>
                <label htmlFor="set-canton" className={p.label}>Kanton</label>
                <select id="set-canton" value={canton} onChange={(e) => setCanton(e.target.value)} className={p.select}>
                  {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="set-municipality" className={p.label}>Gemeinde</label>
                <input
                  id="set-municipality"
                  type="text"
                  required
                  value={municipality}
                  onChange={(e) => setMunicipality(e.target.value)}
                  className={p.input}
                />
              </div>
            </div>

            <div className={s.grid2}>
              <div>
                <label htmlFor="set-parcel" className={p.label}>Parzellennummer</label>
                <input
                  id="set-parcel"
                  type="text"
                  value={parcelNumber}
                  onChange={(e) => setParcelNumber(e.target.value)}
                  className={p.input}
                />
                {project?.egrid && (parcelNumber.trim() !== (project.parcel_number ?? "") || municipality !== (project.location?.municipality ?? "") || canton !== (project.location?.canton ?? "")) && (
                  <p className={s.helpWarn}>
                    Beim Speichern gilt das Grundstück {project.egrid} nicht mehr. TraceBuild sucht es anhand Ihrer Angaben.
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="set-zone" className={p.label}>
                  Bauzone
                  {zoneOriginLabel(project) && (
                    <span className={`${zoneBadgeClass(project)} ${s.chipSm}`}>
                      {zoneOriginLabel(project)}
                    </span>
                  )}
                </label>
                <input
                  id="set-zone"
                  type="text"
                  value={bauzone}
                  onChange={(e) => setBauzone(e.target.value)}
                  placeholder="z.B. W2"
                  className={`${p.input} ${zoneAttention ? s.zoneWarn : ""}`}
                />
                <p className={zoneAttention ? s.helpWarn : s.help}>
                  {zoneAttention
                    ? project?.bauzone
                      ? "Der ÖREB-Auszug lässt keinen sicheren Schluss zu. Bitte bestätigen oder korrigieren."
                      : "Keine sichere Zone aus dem ÖREB-Kataster. Bitte von Hand eintragen."
                    : project?.zone_source === "oereb"
                      ? "Automatisch aus dem ÖREB-Kataster. Eine Änderung hier gilt als manuelle Zone und überschreibt den Auszug."
                      : "Eine hier gesetzte Zone gilt als manuell und hat Vorrang vor dem ÖREB-Auszug."}
                </p>
                {zoneAttention && project?.bauzone && bauzone.trim() === project.bauzone && (
                  <button type="button" onClick={confirmZone} className={`${p.btnGhost} ${p.btnSm}`} style={{ marginTop: 10 }}>
                    Vorschlag bestätigen
                  </button>
                )}
              </div>
            </div>

            <div>
              <span className={p.label}>Domain</span>
              <div className={`${s.value} ${s.valueMuted}`}>Bau / Architektur</div>
            </div>

            {error && (
              <p className={s.alertErr} role="alert">{error}</p>
            )}
            {success && (
              <p className={s.alertOk} role="status">
                Einstellungen gespeichert.
              </p>
            )}

            <div className={s.formFoot}>
              <button
                type="submit"
                disabled={saving}
                className={`${p.btnNavy} ${s.btnFull}`}
              >
                {saving ? "Wird gespeichert…" : "Speichern"}
              </button>
            </div>
          </div>
        </form>

        <section className={`${p.glassFlat} ${p.card} ${s.danger}`}>
          <CardHead
            icon={<Icon><path d="M12 3.5 2.8 19.5h18.4L12 3.5z" /><path d="M12 10v4.5M12 17.2h.01" /></Icon>}
            title="Gefahrenzone"
          />
          <p className={s.dangerText}>
            Das Löschen eines Projekts entfernt alle zugehörigen Dokumente und Analysen unwiderruflich.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={p.btnDanger}
          >
            {deleting ? "Wird gelöscht…" : "Projekt löschen"}
          </button>
        </section>
      </div>
    </>
  );
}
