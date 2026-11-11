/** Land hochgeladener Normen: Wahl je Ebene und Speichern ohne Migration. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { uploadCountry } from "./norm-applies";
import { insertNormWithCountry, type NormInsertClient } from "./norm-country";

test("uploadCountry: Bund nach Wahl (Standard CH), Kanton FL → LI, Gemeinde und Org ohne Land", () => {
  assert.equal(uploadCountry("national", null), "CH");
  assert.equal(uploadCountry("national", null, "li"), "LI");
  assert.equal(uploadCountry("national", null, "DE"), "CH", "Unbekanntes fällt auf CH");
  assert.equal(uploadCountry("national", null, "all"), null, "Alle Länder → NULL");
  assert.equal(uploadCountry("national", null, " ALL "), null);
  assert.equal(uploadCountry("cantonal", "ZH", "all"), "CH", "«Alle Länder» nur bei Ebene Bund");
  assert.equal(uploadCountry("cantonal", "FL"), "LI");
  assert.equal(uploadCountry("cantonal", "ZH", "LI"), "CH", "Kanton bestimmt das Land, nicht die Wahl");
  assert.equal(uploadCountry("municipal", "Vaduz"), null);
  assert.equal(uploadCountry("org", null), null);
});

function fakeClient(errors: ({ message: string } | null)[]) {
  const rows: Record<string, unknown>[] = [];
  const client: NormInsertClient = {
    from: () => ({
      insert: (row) => ({
        select: () => ({
          single: async () => {
            rows.push(row);
            const error = errors.shift() ?? null;
            return { data: error ? null : { id: "n1", ...row }, error };
          },
        }),
      }),
    }),
  };
  return { client, rows };
}

test("insertNormWithCountry: mit Land; fehlt die Spalte, einmal ohne Land", async () => {
  const ok = fakeClient([null]);
  const r1 = await insertNormWithCountry(ok.client, { title: "Baugesetz" }, "LI");
  assert.equal(r1.data?.country, "LI");
  assert.equal(ok.rows.length, 1);

  const missing = fakeClient([{ message: "column norms.country does not exist" }, null]);
  const r2 = await insertNormWithCountry(missing.client, { title: "Baugesetz" }, "LI");
  assert.equal(r2.error, null);
  assert.deepEqual(missing.rows, [{ title: "Baugesetz", country: "LI" }, { title: "Baugesetz" }]);
});

test("insertNormWithCountry: anderer Fehler wird nicht wiederholt", async () => {
  const dup = fakeClient([{ message: "duplicate key value violates unique constraint" }]);
  const r = await insertNormWithCountry(dup.client, { title: "x" }, "CH");
  assert.match(r.error?.message ?? "", /duplicate/);
  assert.equal(dup.rows.length, 1);
});
