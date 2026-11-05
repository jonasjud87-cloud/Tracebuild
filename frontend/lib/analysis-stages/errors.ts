/** Fehlerklassen der Modellaufrufe und die Reaktion darauf. Rein. */
import { MAX_PART_ATTEMPTS } from "./budget";

export type ModelErrorClass =
  | "overload"
  | "fatal_account"
  | "file_fetch"
  | "timeout"
  | "transient"
  | "refusal"
  | "max_tokens"
  | "cancelled"
  | "other";

export interface ClassifiedError {
  error_class: ModelErrorClass;
  retry_after_ms: number | null;
}

interface ErrorLike {
  status?: unknown;
  name?: unknown;
  message?: unknown;
  headers?: unknown;
  error?: {
    type?: unknown;
    message?: unknown;
    error?: { type?: unknown; message?: unknown; details?: { error_code?: unknown } | null } | null;
  } | null;
}

function header(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  if (typeof (headers as { get?: unknown }).get === "function") {
    const v = (headers as Headers).get(name);
    return v == null ? null : String(v);
  }
  const v = (headers as Record<string, unknown>)[name];
  return v == null ? null : String(v);
}

/** Sekunden oder HTTP-Datum. */
export function parseRetryAfter(raw: string | null, nowMs: number = Date.now()): number | null {
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

// Heuristik: Der genaue Wortlaut des 400 beim URL-Abruf ist unbestätigt (Spezifikation Abschnitt 14).
const FILE_FETCH_RE = /\b(fetch|retriev|download|could not (access|load)|unable to (access|load)|url)/i;
const TIMEOUT_RE = /Zeitbudget|timeout|timed out/i;
const NETWORK_RE = /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN|terminated|connection/i;

export function classifyModelError(e: unknown): ClassifiedError {
  const err = (e ?? {}) as ErrorLike;
  const status = typeof err.status === "number" ? err.status : null;
  const inner = err.error?.error ?? null;
  // Fehler mitten im Stream haben keinen HTTP-Status, nur den Typ im Körper.
  const type = String(inner?.type ?? err.error?.type ?? "");
  const code = String(inner?.details?.error_code ?? "");
  const message = String(inner?.message ?? err.error?.message ?? err.message ?? "");
  const name = String(err.name ?? "");
  const result = (error_class: ModelErrorClass, retry_after_ms: number | null = null): ClassifiedError => ({ error_class, retry_after_ms });

  if (code === "enforced_spend_limit_reached") return result("fatal_account");
  if (status === 400 && /You have reached your specified/i.test(message)) return result("fatal_account");
  if (status === 401 || status === 402 || status === 403) return result("fatal_account");
  if (type === "authentication_error" || type === "permission_error" || type === "billing_error") return result("fatal_account");

  if (status === 429 || status === 529 || type === "rate_limit_error" || type === "overloaded_error") {
    return result("overload", parseRetryAfter(header(err.headers, "retry-after")));
  }
  if (status === 400 && FILE_FETCH_RE.test(message)) return result("file_fetch");
  if (name === "APIConnectionTimeoutError" || TIMEOUT_RE.test(message)) return result("timeout");
  if ((status !== null && status >= 500) || type === "api_error") return result("transient");
  if (name === "APIConnectionError" || (status === null && NETWORK_RE.test(message))) return result("transient");
  return result("other");
}

export type PartDecision =
  | { action: "retry"; next_effort?: "low" }
  | { action: "fail" }
  | { action: "overload" }
  | { action: "fatal" }
  | { action: "refetch" }
  | { action: "stop" };

/**
 * Was mit einem gescheiterten Teil geschieht. `attempts` zählt den eben beendeten Versuch mit.
 * `cut`: Die Etappe ging zu Ende, bevor der Aufruf sein volles Budget hatte. Das sagt nichts über
 * den Teil aus, deshalb bleibt die Denktiefe gleich.
 */
export function decideOnFailure(cls: ModelErrorClass | null, attempts: number, cut: boolean): PartDecision {
  switch (cls) {
    case "cancelled":
      return { action: "stop" };
    case "overload":
      return { action: "overload" };
    case "fatal_account":
      return { action: "fatal" };
    case "file_fetch":
      return { action: "refetch" };
    case "refusal":
      return { action: "fail" };
    case "timeout":
      if (attempts >= MAX_PART_ATTEMPTS) return { action: "fail" };
      return cut ? { action: "retry" } : { action: "retry", next_effort: "low" };
    case "transient":
      return attempts >= MAX_PART_ATTEMPTS ? { action: "fail" } : { action: "retry" };
    default:
      // max_tokens, other: einmal wiederholen wie im bisherigen Rettungsdurchgang.
      return attempts >= 2 ? { action: "fail" } : { action: "retry" };
  }
}
