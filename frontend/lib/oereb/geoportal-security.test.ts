/**
 * Prüft den Wortlaut der Migration. Ob Rechte und Trigger in Postgres wirklich greifen, zeigt erst ein
 * Negativtest gegen eine Datenbank mit Anon-Key und JWT; den gibt es hier nicht (siehe Bericht).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../../supabase/migrations/20261106000001_geoportal.sql", import.meta.url), "utf8");

test("Clients verlieren das Schreibrecht auf Auszug und Themen", () => {
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON oereb_extracts, oereb_themes FROM anon, authenticated/);
  for (const table of ["oereb_extracts", "oereb_themes"]) {
    assert.match(sql, new RegExp(`CREATE POLICY "${table}_access" ON ${table}\\s+FOR SELECT`));
    assert.doesNotMatch(sql, new RegExp(`CREATE POLICY "${table}_access" ON ${table}\\s+FOR ALL`));
  }
});

test("Trigger schützt die Identität des Projekts vor Client-Rollen", () => {
  assert.match(sql, /current_user NOT IN \('anon', 'authenticated'\)/);
  for (const column of ["egrid", "bfs_number", "lv95_e", "lv95_n"]) assert.match(sql, new RegExp(`NEW\\.${column} := OLD\\.${column}`));
  assert.match(sql, /BEFORE INSERT OR UPDATE ON projects/);
  assert.doesNotMatch(sql, /protect_project_identity\(\) RETURNS trigger[^$]*SECURITY DEFINER/);
});

test("Nur der Server setzt den Herkunftsstempel, und die RPC bleibt der Service-Role vorbehalten", () => {
  assert.match(sql, /server_fetched_at = now\(\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.replace_oereb_extract\(uuid, jsonb, jsonb\) FROM PUBLIC, anon, authenticated/);
});
