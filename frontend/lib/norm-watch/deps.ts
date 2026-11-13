import { createAdminClient } from "@/lib/supabase/admin";
import { extractPdfText } from "@/lib/pdf-text";
import type { WatchDeps } from "./run";

export function createWatchDeps(): WatchDeps {
  return {
    admin: createAdminClient(),
    fetchFn: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    extractPdf: (bytes) => extractPdfText(bytes, { timeoutMs: 60_000 }),
    now: () => new Date(),
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
