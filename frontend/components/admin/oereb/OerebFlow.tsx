"use client";

import Link from "next/link";
import type { FlowSummary } from "./oereb-summary";
import type { OerebTab } from "./oereb-tabs";

interface Props {
  summary: FlowSummary;
  mappingCount: number | null;
  onGo: (tab: OerebTab) => void;
}

interface Step {
  title: string;
  text: string;
  metric: string;
  action?: { label: string; tab: OerebTab };
}

const LINK = "text-sm font-semibold text-[#151414] underline underline-offset-2 hover:text-[#46464a]";

export default function OerebFlow({ summary, mappingCount, onGo }: Props) {
  const steps: Step[] = [
    {
      title: "Auszug holen",
      text: "Beim Anlegen oder Aktualisieren eines Projekts ruft TraceBuild den ÖREB-Auszug des Grundstücks beim Kanton ab.",
      metric: `${summary.cantonsActive} von ${summary.cantonsTotal} Kantonen aktiv`,
    },
    {
      title: "Dokumente filtern",
      text: "Regeln ohne KI wählen aus den verlinkten Dokumenten die Reglemente aus und lassen Beschlüsse, Pläne und Briefe weg.",
      metric: "Regeln je Kanton",
      action: { label: "Filterregeln ansehen", tab: "regeln" },
    },
    {
      title: "Als Norm speichern",
      text: "Gewählte Reglemente werden gelesen und als Norm der Gemeinde gespeichert. Unsichere Fälle brauchen deinen Entscheid.",
      metric: `${summary.imported} importiert, ${summary.attention} zur Prüfung`,
      action: { label: "Dokumente ansehen", tab: "dokumente" },
    },
    {
      title: "Themen verknüpfen",
      text: "Themen des Auszugs werden mit Normen verknüpft. Passt keine Norm zu einem betroffenen Thema, entsteht eine Lücke.",
      metric: mappingCount === null ? "Zuordnungen werden geladen" : `${mappingCount} aktive Zuordnungen`,
      action: { label: "Zuordnung ansehen", tab: "zuordnung" },
    },
    {
      title: "Analyse",
      text: "Jede dem Projekt zugewiesene Norm wird geprüft: Bund, Kanton, Gemeinde und die Unternehmensnormen der Organisation.",
      metric: "Normen siehe Bibliothek",
    },
  ];

  return (
    <section aria-label="So hängt es zusammen" className="rounded-2xl border border-[rgba(21,20,20,0.08)] bg-white p-4 sm:p-5">
      <h2 className="text-base font-bold text-[#151414]">So hängt es zusammen</h2>
      <ol className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col rounded-xl bg-[#f6f3ee] p-3.5">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-[#151414] text-[13px] font-bold text-white">
                {index + 1}
              </span>
              <span className="text-sm font-bold text-[#151414]">{step.title}</span>
            </span>
            <span className="mt-2 text-sm leading-relaxed text-[#46464a]">{step.text}</span>
            <span className="mt-2 text-sm font-semibold tabular-nums text-[#151414]">{step.metric}</span>
            {step.action ? (
              <button type="button" onClick={() => onGo(step.action!.tab)} className={`${LINK} mt-1 self-start`}>
                {step.action.label}
              </button>
            ) : index === steps.length - 1 ? (
              <Link href="/admin/norms" className={`${LINK} mt-1 self-start`}>
                Zur Bibliothek
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
