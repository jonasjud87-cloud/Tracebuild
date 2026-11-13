import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const SHA256 = /^[0-9a-f]{64}$/;

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function combinePlanHash(fileHashes: string[]): string | null {
  if (!fileHashes.length || fileHashes.some((h) => !isSha256(h))) return null;
  return createHash("sha256").update(fileHashes.slice().sort().join("\n")).digest("hex");
}

export async function hashStoredFiles(admin: SupabaseClient, paths: string[]): Promise<(string | null)[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        const { data, error } = await admin.storage.from("documents").download(path);
        if (error || !data) return null;
        return sha256Hex(Buffer.from(await data.arrayBuffer()));
      } catch {
        return null;
      }
    }),
  );
}
