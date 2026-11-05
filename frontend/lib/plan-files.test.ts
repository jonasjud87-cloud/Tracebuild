import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import { removeUnreferencedPlanFiles } from "./plan-files";

function stub(rows: { document_files?: string[]; documents?: string[]; error?: boolean }) {
  const removed: string[][] = [];
  const admin = {
    from: (table: string) => ({
      select: (column: string) => ({
        in: async () => rows.error
          ? { data: null, error: { message: "DB" } }
          : { data: (table === "document_files" ? rows.document_files ?? [] : rows.documents ?? []).map((v) => ({ [column]: v })), error: null },
      }),
    }),
    storage: { from: () => ({ remove: async (paths: string[]) => { removed.push(paths); } }) },
  };
  return { admin: admin as unknown as SupabaseClient, removed };
}
const url = (p: string) => `u/${p}`;

test("Aufräumen: Dateien bestehender Analysen und fremde Pfade bleiben", async () => {
  const { admin, removed } = stub({ document_files: ["p1/alt.pdf"], documents: ["u/p1/legacy.pdf"] });
  await removeUnreferencedPlanFiles(admin, "p1", ["p1/alt.pdf", "p1/legacy.pdf", "p1/neu.pdf", "p2/fremd.pdf", "p1/../p2/x.pdf"], url);
  assert.deepEqual(removed, [["p1/neu.pdf"]]);
});

test("Aufräumen: Bei einem Datenbankfehler wird nichts gelöscht", async () => {
  const { admin, removed } = stub({ error: true });
  await removeUnreferencedPlanFiles(admin, "p1", ["p1/neu.pdf"], url);
  assert.deepEqual(removed, []);
});
