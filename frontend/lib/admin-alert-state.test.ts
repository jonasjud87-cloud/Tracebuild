import test from "node:test";
import assert from "node:assert/strict";
import { alertFingerprint, countAlerts, splitAlerts } from "./admin-alert-state";
import type { AdminAlert } from "./admin-alerts";

function alert(over: Partial<AdminAlert>): AdminAlert {
  return {
    id: "budget:1",
    rule: "budget",
    severity: "warning",
    title: "Monatsbudget fast aufgebraucht",
    message: "CHF 80.00 von CHF 100.00 (80 %)",
    orgId: "1",
    orgName: "Org",
    href: "/admin",
    createdAt: "2026-11-13T00:00:00.000Z",
    ...over,
  };
}

test("ohne gespeicherten Zustand sind alle Meldungen offen", () => {
  const r = splitAlerts([alert({})], []);
  assert.equal(r.open.length, 1);
  assert.equal(r.archived.length, 0);
});

test("archivierte Meldung wandert ins Archiv", () => {
  const a = alert({});
  const r = splitAlerts([a], [{ alert_id: a.id, state: "archived", fingerprint: alertFingerprint(a) }]);
  assert.equal(r.open.length, 0);
  assert.equal(r.archived.length, 1);
});

test("gelöschte Meldung erscheint nirgends", () => {
  const a = alert({});
  const r = splitAlerts([a], [{ alert_id: a.id, state: "deleted", fingerprint: alertFingerprint(a) }]);
  assert.equal(r.open.length, 0);
  assert.equal(r.archived.length, 0);
});

test("Betragsänderung im Text bringt die Meldung nicht zurück", () => {
  const a = alert({});
  const stored = { alert_id: a.id, state: "deleted" as const, fingerprint: alertFingerprint(a) };
  const r = splitAlerts([alert({ message: "CHF 90.00 von CHF 100.00 (90 %)" })], [stored]);
  assert.equal(r.open.length, 0);
});

test("höhere Dringlichkeit bringt die Meldung zurück", () => {
  const a = alert({});
  const stored = { alert_id: a.id, state: "archived" as const, fingerprint: alertFingerprint(a) };
  const r = splitAlerts([alert({ severity: "critical", title: "Monatsbudget überschritten" })], [stored]);
  assert.equal(r.open.length, 1);
});

test("neue Fassung derselben Quelle kommt zurück", () => {
  const first = alert({ id: "norm_watch:draft:s", rule: "norm_watch", title: "Neue Fassung zur Freigabe", message: "USG: Stand 2025" });
  const stored = { alert_id: first.id, state: "deleted" as const, fingerprint: alertFingerprint(first) };
  const r = splitAlerts([alert({ ...first, message: "USG: Stand 2026" })], [stored]);
  assert.equal(r.open.length, 1);
});

test("countAlerts zählt je Dringlichkeit", () => {
  const c = countAlerts([alert({}), alert({ id: "x", severity: "critical" })]);
  assert.deepEqual(c, { critical: 1, warning: 1, info: 0, total: 2 });
});
