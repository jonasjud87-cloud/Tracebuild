import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../../../supabase/migrations/20261111000002_tool_monitoring.sql", import.meta.url), "utf8");
const sql = raw.replace(/--.*$/gm, "");
const FUNCS = ["monitoring_db_stats()", "monitoring_ai_costs(timestamptz)", "monitoring_geoportal_health()"];

test("Migration: REVOKE und GRANT für alle drei Funktionen", () => {
  for (const f of FUNCS) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`), f);
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${f} TO service_role;`), f);
  }
  assert.ok(!/GRANT[^;]*TO (anon|authenticated|PUBLIC)/i.test(sql));
});

test("Migration: SECURITY DEFINER mit festem search_path", () => {
  const heads = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$\$/g) ?? [];
  assert.equal(heads.length, 3);
  for (const h of heads) {
    assert.match(h, /SECURITY DEFINER/);
    assert.match(h, /SET search_path = pg_catalog, pg_temp/);
  }
});

test("Migration: keine Tabellen, Erweiterungen oder Cron-Jobs", () => {
  assert.ok(!/CREATE TABLE/i.test(sql));
  assert.ok(!/CREATE EXTENSION/i.test(sql));
  assert.ok(!/cron\.schedule/i.test(sql));
  assert.match(sql, /SET lock_timeout/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
});

test("Migration: cron und net nur innerhalb von EXECUTE", () => {
  const withoutDynamic = sql.replace(/EXECUTE \$q\$[\s\S]*?\$q\$/g, "");
  assert.ok(sql.includes("cron.job_run_details"));
  assert.ok(sql.includes("net._http_response"));
  assert.ok(!/\bcron\.|\bnet\./.test(withoutDynamic));
});

test("Migration: Cron-Befehl wird nicht gelesen, Meldung gekürzt", () => {
  assert.ok(!/j\.command/.test(sql));
  assert.match(sql, /left\(r\.return_message, 200\)/);
});
