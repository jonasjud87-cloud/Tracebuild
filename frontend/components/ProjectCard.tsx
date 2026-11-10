"use client";

import Link from "next/link";
import { ArrowRightIcon, BuildingIcon, CalendarIcon, CheckIcon, LayersIcon, PinIcon } from "@/components/dashboard/icons";
import s from "@/app/dashboard/dashboard.module.css";

interface Project {
  id: string;
  name: string;
  domain: string;
  location: { canton: string; municipality: string };
  status: string;
  created_at: string;
  project_number?: string | null;
}

interface Props {
  project: Project;
  view?: "grid" | "list";
}

const DONE_STATUSES = new Set(["closed", "archived", "completed", "done", "finished", "abgeschlossen"]);

export function isProjectDone(status: string): boolean {
  return DONE_STATUSES.has((status ?? "").toLowerCase());
}

function StatusChip({ done }: { done: boolean }) {
  if (done) {
    return (
      <span className={`${s.stChip} ${s.stGreen}`}>
        <CheckIcon size={15} />
        Abgeschlossen
      </span>
    );
  }
  return (
    <span className={`${s.stChip} ${s.stSand}`}>
      <span className={s.stDot} aria-hidden="true" />
      In Arbeit
    </span>
  );
}

function Plan() {
  return <div className={s.plan} aria-hidden="true" />;
}

export default function ProjectCard({ project, view = "grid" }: Props) {
  const date = new Date(project.created_at).toLocaleDateString("de-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const done = isProjectDone(project.status);
  const domain = project.domain === "bau" ? "Bau / Architektur" : project.domain;
  const place = [project.location?.municipality, project.location?.canton].filter(Boolean).join(", ");
  const nameTitle = project.project_number ? `${project.project_number} · ${project.name}` : project.name;
  const nameRow = (
    <div className={s.pNameRow}>
      {project.project_number && <span className={s.pNum}>{project.project_number}</span>}
      <h2 className={s.pName} title={nameTitle}>{project.name}</h2>
    </div>
  );

  if (view === "list") {
    return (
      <Link href={`/projects/${project.id}/analysis`} className={`${s.glass} ${s.pCardBox} ${s.pRow}`}>
        <Plan />
        <div className={s.pTop}>
          <span className={s.pIcon}><BuildingIcon size={24} /></span>
          <div className={s.rowText}>
            {nameRow}
            {place && <p className={s.pLoc}><PinIcon size={16} />{place}</p>}
          </div>
        </div>
        <StatusChip done={done} />
        <div className={s.pFoot}>
          <span className={s.domPill}><LayersIcon size={16} />{domain}</span>
          <span className={s.dateTxt}><CalendarIcon size={17} />{date}</span>
          <span className={s.go} aria-hidden="true"><ArrowRightIcon size={18} /></span>
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/projects/${project.id}/analysis`} className={`${s.glass} ${s.pCardBox}`}>
      <Plan />
      <div className={s.pTop}>
        <span className={s.pIcon}><BuildingIcon size={26} /></span>
        <StatusChip done={done} />
      </div>
      {nameRow}
      {place && <p className={s.pLoc}><PinIcon size={17} />{place}</p>}
      <div className={s.pFoot}>
        <span className={s.domPill}><LayersIcon size={16} />{domain}</span>
        <span className={s.dateTxt}><CalendarIcon size={17} />{date}</span>
        <span className={s.go} aria-hidden="true"><ArrowRightIcon size={18} /></span>
      </div>
    </Link>
  );
}
