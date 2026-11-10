import { test } from "node:test";
import assert from "node:assert/strict";
import { certState, daysUntil, deploymentState, quotaState, statusIndicatorState, worstState } from "./thresholds";

test("Kontingent: Grenzen 80 % und 95 %", () => {
  assert.equal(quotaState(79, 100), "ok");
  assert.equal(quotaState(80, 100), "warn");
  assert.equal(quotaState(94.9, 100), "warn");
  assert.equal(quotaState(95, 100), "error");
  assert.equal(quotaState(120, 100), "error");
});

test("Kontingent: limit null oder 0 ist ok", () => {
  assert.equal(quotaState(1_000_000, null), "ok");
  assert.equal(quotaState(5, 0), "ok");
  assert.equal(quotaState(Number.NaN, 100), "ok");
});

test("Zertifikat: 30 ok, 20 warn, 6 error, abgelaufen error", () => {
  assert.equal(certState(30), "ok");
  assert.equal(certState(21), "ok");
  assert.equal(certState(20), "warn");
  assert.equal(certState(7), "warn");
  assert.equal(certState(6), "error");
  assert.equal(certState(-3), "error");
  assert.equal(certState(Number.NaN), "error");
});

test("daysUntil rundet ab, ungültiges Datum NaN", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  assert.equal(daysUntil("2026-11-30T12:00:00Z", now), 20);
  assert.ok(Number.isNaN(daysUntil("kein Datum", now)));
});

test("Statuspage-Indicator", () => {
  assert.equal(statusIndicatorState("none"), "ok");
  assert.equal(statusIndicatorState("minor"), "warn");
  assert.equal(statusIndicatorState("maintenance"), "warn");
  assert.equal(statusIndicatorState("major"), "error");
  assert.equal(statusIndicatorState("critical"), "error");
  assert.equal(statusIndicatorState("unbekannt"), "warn");
  assert.equal(statusIndicatorState(undefined), "warn");
});

test("worstState ignoriert unconfigured", () => {
  assert.equal(worstState(), "ok");
  assert.equal(worstState("ok", "warn", undefined), "warn");
  assert.equal(worstState("warn", "error", "ok"), "error");
  assert.equal(worstState("unconfigured"), "ok");
});

test("Deployment: Fehler, hinter main, Build läuft, aktuell", () => {
  assert.equal(deploymentState([], null).state, "warn");
  assert.equal(deploymentState([{ state: "ERROR", sha: "b" }, { state: "READY", sha: "a" }], "b").state, "error");
  assert.deepEqual(deploymentState([{ state: "READY", sha: "a" }], "b"), { state: "warn", message: "Produktion ist hinter main" });
  assert.equal(deploymentState([{ state: "BUILDING", sha: "b" }, { state: "READY", sha: "a" }], "b").state, "ok");
  assert.equal(deploymentState([{ state: "READY", sha: "a" }], "a").state, "ok");
  assert.equal(deploymentState([{ state: "READY", sha: "a" }], null).state, "ok");
  assert.equal(deploymentState([{ state: "CANCELED", sha: "a" }], null).state, "warn");
});
