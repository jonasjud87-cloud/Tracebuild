import test from "node:test";
import assert from "node:assert/strict";
import { canApproveCompanyNorms, companyNormApplies, parseScope, scopeLabel } from "./company-norms";
import { applies } from "./norm-applies";

const PID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

test("Entwurf und archivierte Version gelten nie", () => {
  assert.equal(companyNormApplies({ approval_status: "draft" }, { canton: "SG" }), false);
  assert.equal(companyNormApplies({ approval_status: "approved", archived_at: "2026-01-01" }, { canton: "SG" }), false);
});

test("freigegebene Norm ohne Einschränkung gilt überall", () => {
  assert.equal(companyNormApplies({ approval_status: "approved" }, { canton: "SG" }), true);
  assert.equal(companyNormApplies({}, { canton: "" }), true);
});

test("Kantonsbereich gilt nur im gewählten Kanton", () => {
  const n = { approval_status: "approved", scope_mode: "cantons", scope_cantons: ["SG", "ZH"] };
  assert.equal(companyNormApplies(n, { canton: "SG" }), true);
  assert.equal(companyNormApplies(n, { canton: "BE" }), false);
  assert.equal(companyNormApplies({ ...n, scope_cantons: [] }, { canton: "SG" }), false);
});

test("Projektbereich gilt nur für die gewählten Projekte", () => {
  const n = { approval_status: "approved", scope_mode: "projects", scope_project_ids: [PID] };
  assert.equal(companyNormApplies(n, { canton: "SG", projectId: PID }), true);
  assert.equal(companyNormApplies(n, { canton: "SG", projectId: OTHER }), false);
  assert.equal(companyNormApplies(n, { canton: "SG" }), false);
});

test("applies() wertet Unternehmensnormen mit Freigabe und Bereich aus", () => {
  const base = { id: "n", layer: 5, jurisdiction_type: "org", jurisdiction_name: null };
  const place = { canton: "SG", municipality: "Mels", projectId: PID };
  assert.equal(applies({ ...base, approval_status: "draft" }, place), false);
  assert.equal(applies({ ...base, approval_status: "approved", scope_mode: "cantons", scope_cantons: ["ZH"] }, place), false);
  assert.equal(applies({ ...base, approval_status: "approved", scope_mode: "cantons", scope_cantons: ["SG"] }, place), true);
  assert.equal(applies({ ...base }, place), true);
});

test("parseScope prüft Eingaben", () => {
  assert.deepEqual(parseScope({}), { value: { mode: "all", cantons: [], projectIds: [] } });
  assert.deepEqual(parseScope({ mode: "cantons", cantons: "sg, zh" }), { value: { mode: "cantons", cantons: ["SG", "ZH"], projectIds: [] } });
  assert.ok("error" in parseScope({ mode: "cantons", cantons: "" }));
  assert.ok("error" in parseScope({ mode: "cantons", cantons: "XX" }));
  assert.ok("error" in parseScope({ mode: "projects", projectIds: "kein-uuid" }));
  assert.ok("error" in parseScope({ mode: "irgendwas" }));
  assert.deepEqual(parseScope({ mode: "projects", projectIds: [PID] }), { value: { mode: "projects", cantons: [], projectIds: [PID] } });
});

test("scopeLabel und Rollen", () => {
  assert.equal(scopeLabel({}), "Alle Projekte");
  assert.equal(scopeLabel({ scope_mode: "cantons", scope_cantons: ["SG"] }), "Kantone: SG");
  assert.equal(scopeLabel({ scope_mode: "projects", scope_project_ids: [PID] }, { [PID]: "Haus Meier" }), "Haus Meier");
  assert.equal(canApproveCompanyNorms("org_admin"), true);
  assert.equal(canApproveCompanyNorms("member"), false);
});
