import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePlatformCosts } from "./admin-platform-costs";

test("Plattformkosten werden je Monat und Quelle zusammengezählt, jüngster Monat zuerst", () => {
  const rows = aggregatePlatformCosts([
    { source: "digest", costUsd: 0.1, at: "2026-11-13T10:00:00Z" },
    { source: "digest", costUsd: 0.25, at: "2026-11-14T10:00:00Z" },
    { source: "oereb_ocr", costUsd: 0.3, at: "2026-11-02T10:00:00Z" },
    { source: "digest", costUsd: 0.05, at: "2026-10-30T10:00:00Z" },
  ]);
  assert.deepEqual(rows, [
    { month: "2026-11", source: "digest", usd: 0.35, count: 2 },
    { month: "2026-11", source: "oereb_ocr", usd: 0.3, count: 1 },
    { month: "2026-10", source: "digest", usd: 0.05, count: 1 },
  ]);
});

test("ungültige Beträge und Daten werden ignoriert", () => {
  assert.deepEqual(
    aggregatePlatformCosts([
      { source: "digest", costUsd: 0, at: "2026-11-13T10:00:00Z" },
      { source: "digest", costUsd: Number.NaN, at: "2026-11-13T10:00:00Z" },
      { source: "digest", costUsd: 1, at: "kaputt" },
    ]),
    [],
  );
});
