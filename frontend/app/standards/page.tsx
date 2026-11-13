"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import LogoutButton from "@/components/LogoutButton";
import { createClient } from "@/lib/supabase/client";
import { jakarta } from "@/lib/fonts";
import type { NormSupersession } from "@/lib/geoadmin/contract";
import { CANTON_NAMES, groupByJurisdiction } from "@/lib/norm-groups";
import {
  DEFAULT_STANDARDS_TAB,
  STANDARDS_TABS,
  buildEntries,
  matchesQuery,
  splitByTab,
  type FileEntry,
  type Standard,
  type StandardsTab,
} from "@/lib/standards-model";
import { ChevronDownIcon, GridIcon, LayersIcon, PinIcon, SearchIcon } from "@/components/dashboard/icons";
import { FileIcon, GlobeIcon, PlusIcon } from "./icons";
import FileCard from "./FileCard";
import UploadPanel from "./UploadPanel";
import type { ProjectOption } from "./ScopeFields";
import { canApproveCompanyNorms } from "@/lib/company-norms";
import s from "./standards.module.css";

const STANDARDS_PAGE_SIZE = 200;
const CANTONS = Object.keys(CANTON_NAMES);

const INTRO: Record<StandardsTab, { title: string; text: string; bullets?: string[]; preview?: boolean }> = {
  company: {
    title: "Normen Ihres Unternehmens",
    text: "Hier hinterlegen Sie eigene Richtlinien und Standards, zum Beispiel Qualitätsvorgaben, Ausführungsstandards oder interne Brandschutzanforderungen. Eine neue Norm startet als Entwurf und wird erst nach der Freigabe durch eine verantwortliche Person (Organisations-Admin) geprüft.",
    bullets: [
      "Geltungsbereich: alle Projekte, bestimmte Kantone oder bestimmte Projekte",
      "Rangfolge: Gesetzliche Normen gehen immer vor. Eine Unternehmensnorm darf sie verschärfen, aber nie lockern. Verbindliche Normen melden Abweichungen als Mangel, Empfehlungen höchstens als Hinweis.",
      "Versionen: Eine neue Version ersetzt die bisherige erst nach ihrer Freigabe. Frühere Versionen bleiben im Verlauf sichtbar.",
    ],
  },
  own: {
    title: "Eigene Fassungen von Gesetzen und Reglementen",
    text: "Hier liegen Gesetze und Reglemente, die Sie selbst hochgeladen haben. Liegt für eine Gemeinde ein amtlicher Text vor, gilt dieser. Sie können Ihre Fassung als massgebend festlegen.",
  },
  legal: {
    title: "Gesetzliche Grundlagen",
    text: "Von TraceBuild gepflegte Normen für alle Organisationen. Sie sind hier nur lesbar und gelten je nach Bund, Kanton und Gemeinde Ihres Projekts.",
  },
};

const EMPTY: Record<StandardsTab, { main: string; sub: string }> = {
  company: { main: "Noch keine Unternehmensnormen.", sub: "Laden Sie eine PDF- oder Textdatei mit einer Richtlinie Ihres Unternehmens hoch." },
  own: { main: "Keine eigenen Fassungen.", sub: "Hier erscheinen Gesetze und Reglemente, die Sie selbst hochladen." },
  legal: { main: "Keine gesetzlichen Grundlagen gefunden.", sub: "Suche oder Filter anpassen." },
};

export default function StandardsPage() {
  const router = useRouter();
  const uid = useId();
  const [email, setEmail] = useState("");
  const [standards, setStandards] = useState<Standard[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<StandardsTab>(DEFAULT_STANDARDS_TAB);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filterCanton, setFilterCanton] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!data.user) {
          router.push("/login");
          return;
        }
        setEmail(data.user.email ?? "");
      });
  }, [router]);

  const loadStandards = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ domain: "bau" });
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
  }, []);

  useEffect(() => {
    loadStandards();
  }, [loadStandards]);

  useEffect(() => {
    api
      .get<{ role: string }>("/auth/me")
      .then((me) => setRole(me.role))
      .catch(() => setRole(""));
    api
      .get<{ id: string; name: string }[]>("/projects")
      .then((list) => setProjects((list ?? []).map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));
  }, []);

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

  const entries = useMemo(() => buildEntries(standards), [standards]);
  const split = useMemo(() => splitByTab(entries), [entries]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    return split[tab].filter((en) => {
      if (filterCategory && en.category !== filterCategory) return false;
      if (filterCanton && !(en.jurisdiction_type === "cantonal" && en.jurisdiction_name === filterCanton)) return false;
      return matchesQuery(en, needle);
    });
  }, [split, tab, filterCategory, filterCanton, needle]);

  const categories = useMemo(() => Array.from(new Set(split[tab].map((en) => en.category))).sort(), [split, tab]);
  const showUpload = tab !== "legal";
  const showCantonFilter = tab !== "company";

  const changeTab = useCallback((next: StandardsTab) => {
    setTab(next);
    setUploadOpen(false);
    setFilterCanton("");
    setFilterCategory("");
    setQuery("");
  }, []);

  const moveTab = (direction: 1 | -1) => {
    const index = STANDARDS_TABS.findIndex((t) => t.id === tab);
    const next = STANDARDS_TABS[(index + direction + STANDARDS_TABS.length) % STANDARDS_TABS.length].id;
    changeTab(next);
    tabRefs.current[next]?.focus();
  };

  const kpis = [
    { icon: <FileIcon size={26} />, value: split.company.length, label: "Unternehmensnormen" },
    { icon: <LayersIcon size={26} />, value: split.own.length, label: "Eigene Fassungen" },
    { icon: <GlobeIcon size={26} />, value: split.legal.length, label: "Gesetzliche Grundlagen" },
    { icon: <GridIcon size={26} />, value: new Set(entries.map((en) => en.category)).size, label: "Kategorien" },
  ];

  const intro = INTRO[tab];
  const empty = EMPTY[tab];
  const groups = tab === "legal" ? groupByJurisdiction(visible.map((en) => ({ jurisdictionType: en.jurisdiction_type, jurisdictionName: en.jurisdiction_name, entry: en }))) : [];

  const canApprove = canApproveCompanyNorms(role);
  const renderCard = (entry: FileEntry) => (
    <FileCard
      key={entry.ids[0]}
      entry={entry}
      onDelete={handleDelete}
      onAuthoritative={handleAuthoritative}
      projects={projects}
      canApprove={canApprove}
      onChanged={loadStandards}
    />
  );

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
                  <span className={s.avatar} aria-hidden="true">
                    {email.slice(0, 1).toUpperCase()}
                  </span>
                  <span className={s.email}>{email}</span>
                </div>
              )}
              <LogoutButton className={s.logout} />
            </div>
          </header>
          <h1 className={s.title}>Unternehmensnormen</h1>
          <p className={s.lead}>Eigene Normen und Richtlinien Ihres Unternehmens, dazu die gesetzlichen Grundlagen, gegen die Ihre Projekte geprüft werden.</p>
        </div>
      </div>

      <div className={s.page}>
        <main>
          <ul className={s.kpis} aria-label="Kennzahlen">
            {kpis.map((k) => (
              <li key={k.label} className={`${s.kpi} ${s.glass}`}>
                <span className={s.iconBox} aria-hidden="true">
                  {k.icon}
                </span>
                <div className={s.kpiText}>
                  <p className={s.kpiValue}>{loading ? "–" : k.value}</p>
                  <p className={s.kpiLabel}>{k.label}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className={s.tabs} role="tablist" aria-label="Bereiche der Normen">
            {STANDARDS_TABS.map((t) => {
              const selected = t.id === tab;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  id={`${uid}-tab-${t.id}`}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls={`${uid}-panel`}
                  tabIndex={selected ? 0 : -1}
                  title={t.hint}
                  onClick={() => changeTab(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight") {
                      e.preventDefault();
                      moveTab(1);
                    } else if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      moveTab(-1);
                    }
                  }}
                  className={`${s.tab} ${selected ? s.tabActive : ""}`}
                >
                  {t.label}
                  {!loading && <span className={s.tabCount}>{split[t.id].length}</span>}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
            <section className={s.intro} aria-label={intro.title}>
              {intro.preview && <span className={s.preview}>Vorschau, wird ausgebaut</span>}
              <h2 className={s.introTitle}>{intro.title}</h2>
              <p className={s.introText}>{intro.text}</p>
              {intro.bullets && (
                <>
                  <p className={s.introText}>So funktioniert es:</p>
                  <ul className={s.introList}>
                    {intro.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <div className={s.toolbar}>
              {showUpload && (
                <button
                  type="button"
                  onClick={() => setUploadOpen((o) => !o)}
                  className={s.btnDark}
                  aria-expanded={uploadOpen}
                  aria-controls={`${uid}-upload`}
                >
                  <PlusIcon size={20} />
                  {tab === "company" ? "Unternehmensnorm hochladen" : "Eigene Fassung hochladen"}
                </button>
              )}

              <div className={`${s.field} ${s.searchField}`}>
                <label htmlFor={`${uid}-search`} className={s.sr}>
                  Normen durchsuchen
                </label>
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

              {showCantonFilter && (
                <div className={`${s.field} ${s.selectField}`}>
                  <label htmlFor={`${uid}-canton`} className={s.sr}>
                    Kanton filtern
                  </label>
                  <PinIcon size={20} />
                  <select id={`${uid}-canton`} value={filterCanton} onChange={(e) => setFilterCanton(e.target.value)} className={s.bare}>
                    <option value="">Alle Kantone</option>
                    {CANTONS.map((c) => (
                      <option key={c} value={c}>
                        {c === "FL" ? "FL (Liechtenstein)" : c}
                      </option>
                    ))}
                  </select>
                  <span className={s.chev} aria-hidden="true">
                    <ChevronDownIcon size={18} />
                  </span>
                </div>
              )}

              <div className={`${s.field} ${s.selectField}`}>
                <label htmlFor={`${uid}-cat`} className={s.sr}>
                  Kategorie filtern
                </label>
                <LayersIcon size={20} />
                <select
                  id={`${uid}-cat`}
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className={s.bare}
                  disabled={categories.length === 0}
                >
                  <option value="">Alle Kategorien</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className={s.chev} aria-hidden="true">
                  <ChevronDownIcon size={18} />
                </span>
              </div>
            </div>

            {showUpload && uploadOpen && (
              <UploadPanel
                key={tab}
                mode={tab === "company" ? "company" : "law"}
                projects={projects}
                onClose={() => setUploadOpen(false)}
                onUploaded={() => {
                  void loadStandards();
                }}
              />
            )}

            <h2 className={s.listHead}>
              <span className={s.listTitle}>{STANDARDS_TABS.find((t) => t.id === tab)?.label}</span>
              {visible.length > 0 && (
                <span className={s.count}>
                  ({visible.length} {visible.length === 1 ? "Datei" : "Dateien"})
                </span>
              )}
            </h2>

            {loading ? (
              <ul className={s.list} aria-busy="true" aria-label="Normen werden geladen">
                {[...Array(4)].map((_, i) => (
                  <li key={i} className={s.skel}>
                    <span className={s.skelBar} style={{ width: "28%" }} />
                    <span className={s.skelBar} style={{ width: "62%" }} />
                  </li>
                ))}
              </ul>
            ) : visible.length === 0 ? (
              <div className={`${s.empty} ${s.glass}`} role="status">
                <p className={s.emptyMain}>{split[tab].length === 0 ? empty.main : "Keine Normen für diese Auswahl."}</p>
                <p className={s.emptySub}>{split[tab].length === 0 ? empty.sub : "Suche oder Filter anpassen."}</p>
              </div>
            ) : tab === "legal" ? (
              <div>
                {groups.map((g) => (
                  <details key={g.key} className={s.group} open={!g.key.startsWith("municipal:") || !!needle}>
                    <summary className={s.groupSummary}>
                      <h3 className={s.groupTitle}>{g.label}</h3>
                      <span className={s.groupCount}>
                        {g.items.length} {g.items.length === 1 ? "Norm" : "Normen"}
                      </span>
                    </summary>
                    <ul className={s.list}>{g.items.map((item) => renderCard(item.entry))}</ul>
                  </details>
                ))}
              </div>
            ) : (
              <ul className={s.list}>{visible.map(renderCard)}</ul>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
