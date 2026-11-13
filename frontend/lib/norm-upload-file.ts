import { extractPdfText } from "@/lib/pdf-text";
import { normTextTooLongMessage } from "@/lib/norm-text";
import type { createAdminClient } from "@/lib/supabase/admin";

export type ReadUpload =
  | { ok: true; text: string; bytes: Buffer; isPdf: boolean }
  | { ok: false; message: string; status: number };

export async function readNormUpload(file: File): Promise<ReadUpload> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const isPdf = file.type === "application/pdf" || file.name.endsWith(".pdf");
  let text = "";
  if (isPdf) {
    try {
      text = await extractPdfText(bytes);
    } catch (e) {
      console.error("PDF-Textextraktion fehlgeschlagen:", e);
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return { ok: false, message: `PDF konnte nicht gelesen werden — ${detail}`, status: 500 };
    }
    if (!text.trim()) {
      return { ok: false, message: "Aus diesem PDF liess sich kein Text lesen — vermutlich ein Scan ohne Texterkennung (OCR).", status: 400 };
    }
  } else {
    text = bytes.toString("utf-8");
  }
  const tooLong = normTextTooLongMessage(text);
  if (tooLong) return { ok: false, message: tooLong, status: 413 };
  return { ok: true, text, bytes, isPdf };
}

export async function storeNormPdf(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  file: File,
  bytes: Buffer,
): Promise<string | null> {
  try {
    const storagePath = `norms/${orgId}/${crypto.randomUUID()}_${file.name}`;
    const { data } = await admin.storage.from("documents").upload(storagePath, bytes, { contentType: "application/pdf" });
    if (!data) return null;
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/documents/${storagePath}`;
  } catch {
    return null;
  }
}

export async function projectsBelongToOrg(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  ids: string[],
): Promise<boolean> {
  if (!ids.length) return true;
  const { data, error } = await admin.from("projects").select("id").eq("org_id", orgId).in("id", ids);
  if (error) return false;
  return (data ?? []).length === ids.length;
}
