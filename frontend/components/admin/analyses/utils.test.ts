import assert from "node:assert/strict";
import { test } from "node:test";
import { isOrphaned } from "./utils";

const created = "2026-11-05T10:00:00Z";
const minutes = (n: number) => Date.parse(created) + n * 60_000;

test("isOrphaned: lange Analyse mit frischer Aktivität ist gesund", () => {
  const row = { status: "running", createdAt: created, lastActivityAt: "2026-11-05T10:20:00Z" };
  assert.equal(isOrphaned(row, minutes(22), 6), false);
  assert.equal(isOrphaned(row, minutes(27), 6), true);
});

test("isOrphaned: ohne Aktivität zählt wie bisher der Start", () => {
  assert.equal(isOrphaned({ status: "running", createdAt: created }, minutes(5), 6), false);
  assert.equal(isOrphaned({ status: "running", createdAt: created, lastActivityAt: null }, minutes(7), 6), true);
  assert.equal(isOrphaned({ status: "done", createdAt: created }, minutes(99), 6), false);
});
