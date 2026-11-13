import type { createAdminClient } from "@/lib/supabase/admin";
import { normTextHash } from "@/lib/norm-hash";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

type Admin = ReturnType<typeof createAdminClient>;

const OPTIONAL_COLUMNS = ["source_checked_at", "text_sha256"];

export async function updateNormRow(admin: Admin, normId: string, patch: Record<string, unknown>): Promise<string | null> {
  const payload: Record<string, unknown> = { ...patch, source_checked_at: new Date().toISOString() };
  if (typeof patch.text === "string") payload.text_sha256 = normTextHash(patch.text);

  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    const { error } = await admin.from("norms").update(payload).eq("id", normId);
    if (!error) return null;
    const missing = isMissingSchema(error.message) ? OPTIONAL_COLUMNS.find((c) => c in payload && error.message.includes(c)) : undefined;
    if (!missing) return error.message;
    delete payload[missing];
  }
  return "Norm konnte nicht aktualisiert werden";
}
