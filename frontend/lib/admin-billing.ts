export type CostSource = "analysis" | "chat" | "norm";

export interface BillingAnalysis {
  source?: CostSource;
  costUsd: number;
  createdAt: string;
  orgId: string;
}

export interface OrgCostRow {
  orgId: string;
  orgName: string;
  month: string;
  analyseCount: number;
  analyseCost: number;
  chatCount: number;
  chatCost: number;
  normCount: number;
  normCost: number;
  storageCost: number;
  databaseCost: number;
  ocrCost: number;
  infraCost: number;
  totalCost: number;
  usdAmount: number;
  usdToChf: number;
  currency: "CHF";
  status: "laufend" | "final";
  storageGB: number;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitChf: number;
  totalChf: number;
}

export interface Invoice {
  id: string;
  orgId: string;
  orgName: string;
  month: string;
  analyseCount: number;
  amountChf: number;
  usdAmount: number;
  usdToChf: number;
  currency: "CHF";
  status: "laufend" | "final";
  issuedAt: string;
  lines: InvoiceLine[];
}

export type Period = { kind: "month"; value: string } | { kind: "year"; value: string };

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

const zurichMonth = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
});

export function monthKey(input: string | number | Date): string {
  const parts = zurichMonth.formatToParts(new Date(input));
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

export function toCents(chf: number): number {
  return Math.round((chf + Number.EPSILON) * 100);
}

export function parseYear(raw: string | null): string | null {
  if (raw === null) return null;
  if (!YEAR_RE.test(raw)) return null;
  const y = Number(raw);
  return y >= 2000 && y <= 2100 ? raw : null;
}

export function parsePeriod(raw: string | null): Period | null {
  if (!raw) return null;
  const m = MONTH_RE.exec(raw);
  if (m) return parseYear(m[1]) ? { kind: "month", value: raw } : null;
  const y = parseYear(raw);
  return y ? { kind: "year", value: y } : null;
}

export function aggregateCosts(
  analyses: BillingAnalysis[],
  orgNames: Map<string, string>,
  usdToChf: number,
  now: number = Date.now(),
): OrgCostRow[] {
  const nowMonth = monthKey(now);
  const buckets = new Map<
    string,
    { orgId: string; month: string; count: Record<CostSource, number>; usd: Record<CostSource, number> }
  >();

  for (const a of analyses) {
    if (!(a.costUsd > 0) || !Number.isFinite(a.costUsd)) continue;
    const source = a.source ?? "analysis";
    const month = monthKey(a.createdAt);
    const key = `${a.orgId}:${month}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        orgId: a.orgId,
        month,
        count: { analysis: 0, chat: 0, norm: 0 },
        usd: { analysis: 0, chat: 0, norm: 0 },
      };
      buckets.set(key, b);
    }
    b.count[source] += 1;
    b.usd[source] += a.costUsd;
  }

  return Array.from(buckets.values())
    .map((b): OrgCostRow => {
      const analyseCents = toCents(b.usd.analysis * usdToChf);
      const chatCents = toCents(b.usd.chat * usdToChf);
      const normCents = toCents(b.usd.norm * usdToChf);
      const usd = b.usd.analysis + b.usd.chat + b.usd.norm;
      return {
        orgId: b.orgId,
        orgName: orgNames.get(b.orgId) ?? "Unbekannt",
        month: b.month,
        analyseCount: b.count.analysis,
        analyseCost: analyseCents / 100,
        chatCount: b.count.chat,
        chatCost: chatCents / 100,
        normCount: b.count.norm,
        normCost: normCents / 100,
        storageCost: 0,
        databaseCost: 0,
        ocrCost: 0,
        infraCost: 0,
        totalCost: (analyseCents + chatCents + normCents) / 100,
        usdAmount: Math.round(usd * 10000) / 10000,
        usdToChf,
        currency: "CHF",
        status: b.month < nowMonth ? "final" : "laufend",
        storageGB: 0,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month) || a.orgName.localeCompare(b.orgName));
}

export function invoiceNumber(orgId: string, month: string, length: number = 6): string {
  return `TB-${month}-${orgId.slice(0, length)}`;
}

export function invoiceNumberResolver(rows: { orgId: string; month: string }[]): (orgId: string, month: string) => string {
  const byMonth = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byMonth.get(r.month) ?? new Set<string>();
    set.add(r.orgId);
    byMonth.set(r.month, set);
  }
  return (orgId, month) => {
    const others = Array.from(byMonth.get(month) ?? []).filter((id) => id !== orgId);
    let length = 6;
    while (length < orgId.length && others.some((id) => id.slice(0, length) === orgId.slice(0, length))) length++;
    return invoiceNumber(orgId, month, length);
  };
}

function zurichOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

function zurichMonthStartIso(year: number, monthIndex: number): string {
  const local = Date.UTC(year, monthIndex, 1);
  const first = local - zurichOffsetMs(local);
  return new Date(local - zurichOffsetMs(first)).toISOString();
}

export function periodRange(period: Period): { from: string; to: string } {
  if (period.kind === "year") {
    const y = Number(period.value);
    return { from: zurichMonthStartIso(y, 0), to: zurichMonthStartIso(y + 1, 0) };
  }
  const [y, m] = period.value.split("-").map(Number);
  return { from: zurichMonthStartIso(y, m - 1), to: zurichMonthStartIso(y, m) };
}

export function monthEndIso(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)).toISOString();
}

export const SOURCE_LABELS = {
  analysis: "KI-Analysen",
  chat: "KI-Chat",
  norm: "Normen-Zusammenfassungen",
} as const;

export function costLines(r: OrgCostRow): InvoiceLine[] {
  const parts: [string, number, number][] = [
    [SOURCE_LABELS.analysis, r.analyseCount, r.analyseCost],
    [SOURCE_LABELS.chat, r.chatCount, r.chatCost],
    [SOURCE_LABELS.norm, r.normCount, r.normCost],
  ];
  return parts
    .filter(([, , total]) => total > 0)
    .map(([description, quantity, totalChf]) => ({
      description,
      quantity,
      unitChf: quantity > 0 ? Math.round((totalChf / quantity) * 10000) / 10000 : 0,
      totalChf,
    }));
}

export function buildInvoices(rows: OrgCostRow[], year: string): Invoice[] {
  const numberOf = invoiceNumberResolver(rows);
  return rows
    .filter((r) => r.month.startsWith(`${year}-`))
    .map((r): Invoice => {
      return {
        id: numberOf(r.orgId, r.month),
        orgId: r.orgId,
        orgName: r.orgName,
        month: r.month,
        analyseCount: r.analyseCount,
        amountChf: r.totalCost,
        usdAmount: r.usdAmount,
        usdToChf: r.usdToChf,
        currency: "CHF",
        status: r.status,
        issuedAt: monthEndIso(r.month),
        lines: costLines(r),
      };
    });
}

export function filterByPeriod(rows: OrgCostRow[], period: Period): OrgCostRow[] {
  return rows
    .filter((r) => (period.kind === "month" ? r.month === period.value : r.month.startsWith(`${period.value}-`)))
    .sort((a, b) => a.month.localeCompare(b.month) || a.orgName.localeCompare(b.orgName));
}

export interface ReportTotals {
  analyseCount: number;
  chatCount: number;
  normCount: number;
  analyseChf: number;
  chatChf: number;
  normChf: number;
  usdAmount: number;
  amountChf: number;
}

export function sumRows(rows: OrgCostRow[]): ReportTotals {
  let cents = 0;
  let analyseCents = 0;
  let chatCents = 0;
  let normCents = 0;
  let count = 0;
  let chatCount = 0;
  let normCount = 0;
  let usd = 0;
  for (const r of rows) {
    cents += toCents(r.totalCost);
    analyseCents += toCents(r.analyseCost);
    chatCents += toCents(r.chatCost);
    normCents += toCents(r.normCost);
    count += r.analyseCount;
    chatCount += r.chatCount;
    normCount += r.normCount;
    usd += r.usdAmount;
  }
  return {
    analyseCount: count,
    chatCount,
    normCount,
    analyseChf: analyseCents / 100,
    chatChf: chatCents / 100,
    normChf: normCents / 100,
    usdAmount: Math.round(usd * 10000) / 10000,
    amountChf: cents / 100,
  };
}

export interface UnassignedCosts {
  count: number;
  usd: number;
  chf: number;
}

export function reportFilename(period: Period, ext: "csv" | "pdf"): string {
  return `tracebuild-kosten-${period.value}.${ext}`;
}

export function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildCsv(rows: OrgCostRow[], usdToChf: number, unassigned?: UnassignedCosts): string {
  const totals = sumRows(rows);
  const numberOf = invoiceNumberResolver(rows);
  const lines: string[] = [];
  const push = (cells: string[]) => lines.push(cells.join(";"));

  push([
    "Rechnungsnummer",
    "Organisation",
    "Monat",
    "Analysen",
    "KI-Analysen CHF",
    "Chat-Nachrichten",
    "KI-Chat CHF",
    "Normen-Zusammenfassungen",
    "Normen-Zusammenfassungen CHF",
    "Betrag USD",
    "Betrag CHF",
    "Status",
  ]);
  for (const r of rows) {
    push([
      csvText(numberOf(r.orgId, r.month)),
      csvText(r.orgName),
      r.month,
      String(r.analyseCount),
      r.analyseCost.toFixed(2),
      String(r.chatCount),
      r.chatCost.toFixed(2),
      String(r.normCount),
      r.normCost.toFixed(2),
      r.usdAmount.toFixed(4),
      r.totalCost.toFixed(2),
      r.status,
    ]);
  }
  push([
    "Gesamtsumme",
    "",
    "",
    String(totals.analyseCount),
    totals.analyseChf.toFixed(2),
    String(totals.chatCount),
    totals.chatChf.toFixed(2),
    String(totals.normCount),
    totals.normChf.toFixed(2),
    totals.usdAmount.toFixed(4),
    totals.amountChf.toFixed(2),
    "",
  ]);
  if (unassigned && unassigned.count > 0) {
    push([
      "Nicht zuordenbare Kosten (CHF)",
      `${unassigned.count} Positionen, nicht in der Gesamtsumme enthalten`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      unassigned.usd.toFixed(4),
      unassigned.chf.toFixed(2),
      "",
    ]);
  }
  push(["Kurs USD/CHF", String(Math.round(usdToChf * 10000) / 10000), "", "", "", "", "", "", "", "", "", ""]);

  return `﻿${lines.join("\r\n")}\r\n`;
}
