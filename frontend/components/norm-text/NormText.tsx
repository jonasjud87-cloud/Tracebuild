"use client";

import { useEffect, useMemo, useState } from "react";
import {
  isSameHost,
  normSummary,
  parseNormText,
  safeHref,
  type ArticleBlock,
  type BodyBlock,
  type NormBlock,
} from "@/lib/norm-structure";
import p from "@/app/projects/project.module.css";
import s from "./NormText.module.css";

interface NormTextProps {
  normId: string;
  text: string;
  /** Ganzes Dokument statt eines Auszugs (ÖREB-Dokument oder hochgeladenes PDF). */
  wholeDocument: boolean;
  pdfUrl: string | null;
  loadingFull: boolean;
  loadError: boolean;
}

const STEP = 150;
const OVERVIEW_MIN = 5;
const WIDE_QUERY = "(min-width: 700px)";

/** Breite genug für die eingebettete PDF-Ansicht. Auf Mobil bleibt nur der Link. */
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
}

function BodyView({ block }: { block: BodyBlock }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <div className={s.para}>
          {block.marginal && <span className={s.marginal}>{block.marginal}</span>}
          <span className={s.paraNum}>{block.number ?? ""}</span>
          <p className={s.paraText}>{block.text}</p>
        </div>
      );
    case "list":
      return (
        <ul role="list" className={s.list}>
          {block.items.map((item, i) => (
            <li key={i} className={s.listItem}>
              <span className={s.listMarker}>{item.marker}</span>
              <span className={s.listText}>{item.text}</span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "lines":
      if (block.variant === "footnote" || block.variant === "note") {
        // Fussnoten (Fedlex) und Hinweisspalte: klein und gedämpft, nicht Teil des Absatzes.
        return <p className={s.sideNote}>{block.lines.join("\n")}</p>;
      }
      return <p className={block.variant === "header" ? s.runningHeader : s.lines}>{block.lines.join("\n")}</p>;
    case "page":
      return (
        <div className={s.page} role="separator" aria-label={`Seite ${block.number}`}>
          <span>Seite {block.number}</span>
        </div>
      );
  }
}

/** Ohne Kapitelköpfe sind Artikel die oberste Ebene (h3), sonst eine Ebene darunter (h4). */
function ArticleView({ block, id, nested }: { block: ArticleBlock; id: string; nested: boolean }) {
  const relabelled = block.label.replace(/\s+/g, "") !== block.rawLabel.replace(/\s+/g, "");
  const Heading = nested ? "h4" : "h3";
  // Kein aria-label: Sonst wird jeder Artikel zur Landmarke (bis zu 180 je Norm).
  return (
    <section id={id} className={s.article} tabIndex={-1}>
      <Heading className={s.articleHead}>
        <span className={s.articleLabel} title={relabelled ? block.rawLabel : undefined}>
          {block.label}
        </span>
        {block.title && <span className={s.articleTitle}>{block.title}</span>}
      </Heading>
      {block.body.map((b, i) => (
        <BodyView key={i} block={b} />
      ))}
    </section>
  );
}

function BlockView({ block, id, nested }: { block: NormBlock; id: string; nested: boolean }) {
  switch (block.kind) {
    case "article":
      return <ArticleView block={block} id={id} nested={nested} />;
    case "heading":
      return <h3 className={s.heading}>{block.text}</h3>;
    case "toc":
      return (
        <ul role="list" className={s.toc} aria-label="Inhaltsverzeichnis">
          {block.entries.map((e, i) => (
            <li key={i} className={s.tocEntry}>
              <span>{e.label}</span>
              {e.page && <span className={s.tocPage}>{e.page}</span>}
            </li>
          ))}
        </ul>
      );
    default:
      return <BodyView block={block} />;
  }
}

export default function NormText({ normId, text, wholeDocument, pdfUrl, loadingFull, loadError }: NormTextProps) {
  const parsed = useMemo(() => parseNormText(text), [text]);
  const hasMarginals = useMemo(
    () =>
      parsed.blocks.some(
        (b) =>
          (b.kind === "paragraph" && b.marginal) ||
          (b.kind === "article" && b.body.some((x) => x.kind === "paragraph" && x.marginal)),
      ),
    [parsed],
  );
  const nested = useMemo(() => parsed.blocks.some((b) => b.kind === "heading"), [parsed]);
  const [raw, setRaw] = useState(false);
  const [view, setView] = useState<"text" | "pdf">("text");
  const [visible, setVisible] = useState(STEP);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const wide = useWide();

  const href = safeHref(pdfUrl);
  const canEmbed = !!href && isSameHost(href, process.env.NEXT_PUBLIC_SUPABASE_URL ?? null);
  const showPdf = canEmbed && wide && view === "pdf";
  const summary = normSummary(parsed);
  const blockId = (i: number) => `norm-${normId}-b${i}`;
  const overview = parsed.blocks
    .map((b, i) => ({ b, i }))
    .filter((x): x is { b: ArticleBlock; i: number } => x.b.kind === "article");

  useEffect(() => {
    if (!jumpTo) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(jumpTo);
      target?.scrollIntoView({ block: "start" });
      // Fokus aufs Ziel, damit Tastatur und Screenreader dort weiterlesen.
      target?.focus({ preventScroll: true });
      setJumpTo(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [jumpTo, visible]);

  const total = parsed.blocks.length;
  const remaining = Math.max(0, total - visible);

  return (
    <div className={`${s.root} ${hasMarginals ? s.withMarginals : ""}`}>
      {loadingFull && (
        <p role="status" className={s.hint}>
          Volltext wird geladen …
        </p>
      )}
      {loadError && (
        <p role="alert" className={`${s.hint} ${s.hintErr}`}>
          Volltext konnte nicht geladen werden. Angezeigt ist der Anfang.
        </p>
      )}

      {(wholeDocument || summary || href || parsed.structured) && (
        <div className={s.toolbar}>
          {wholeDocument && <span className={p.chipSand}>Ganzes Dokument</span>}
          {summary && <span className={p.chip}>{summary}</span>}
          {canEmbed && wide && (
            <div className={s.segmented} role="group" aria-label="Ansicht">
              <button type="button" aria-pressed={view === "text"} onClick={() => setView("text")} className={s.segment}>
                Text
              </button>
              <button type="button" aria-pressed={view === "pdf"} onClick={() => setView("pdf")} className={s.segment}>
                PDF
              </button>
            </div>
          )}
          {parsed.structured && !showPdf && (
            <button type="button" aria-pressed={raw} onClick={() => setRaw((v) => !v)} className={`${p.btnGhost} ${p.btnSm}`}>
              {raw ? "Gegliedert anzeigen" : "Als Rohtext anzeigen"}
            </button>
          )}
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className={s.pdfLink}>
              Original-PDF öffnen ↗
            </a>
          )}
        </div>
      )}

      {showPdf && href ? (
        <iframe src={href} title="PDF-Ansicht der Norm" loading="lazy" className={s.pdfFrame} />
      ) : !parsed.structured || raw ? (
        <p className={s.raw}>{text}</p>
      ) : (
        <>
          {overview.length >= OVERVIEW_MIN && (
            <details className={s.overview}>
              <summary>Artikelübersicht ({overview.length})</summary>
              <ol role="list" className={s.overviewList}>
                {overview.map(({ b, i }) => (
                  <li key={i}>
                    <a
                      href={`#${blockId(i)}`}
                      className={s.overviewLink}
                      onClick={(e) => {
                        e.preventDefault();
                        setVisible(total);
                        setJumpTo(blockId(i));
                      }}
                    >
                      <strong>{b.label}</strong>
                      {b.title ? ` ${b.title}` : ""}
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          )}
          <div className={s.blocks}>
            {parsed.blocks.slice(0, visible).map((b, i) => (
              <BlockView key={i} block={b} id={blockId(i)} nested={nested} />
            ))}
          </div>
          {remaining > 0 && (
            <div className={s.more}>
              <button type="button" onClick={() => setVisible((v) => v + STEP)} className={`${p.btnGhost} ${p.btnSm}`}>
                Weitere {Math.min(STEP, remaining)} Abschnitte anzeigen
              </button>
              <button type="button" onClick={() => setVisible(total)} className={s.textBtn}>
                Alles anzeigen
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
