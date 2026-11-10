import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_NUMBER_CHECK,
  PROJECT_NUMBER_UNIQUE_INDEX,
  isMissingProjectNumberColumn,
  parseProjectNumber,
  projectNumberDbError,
} from "./project-number";

function valueOf(input: unknown): string | null {
  const r = parseProjectNumber(input);
  assert.ok("value" in r, `Fehler statt Wert für ${JSON.stringify(input)}`);
  return r.value;
}

function errorOf(input: unknown): string {
  const r = parseProjectNumber(input);
  assert.ok("error" in r, `Wert statt Fehler für ${JSON.stringify(input)}`);
  return r.error;
}

test("trimmt die Eingabe, Innenleerzeichen bleiben", () => {
  assert.equal(valueOf("  2024-017 "), "2024-017");
  assert.equal(valueOf("P 12 A"), "P 12 A");
});

test("leere Eingaben ergeben null", () => {
  for (const input of [undefined, null, "", "   "]) assert.equal(valueOf(input), null);
});

test("Länge: 40 erlaubt, 41 Fehler, gezählt in Codepoints", () => {
  assert.equal(valueOf("a".repeat(40)), "a".repeat(40));
  assert.match(errorOf("a".repeat(41)), /höchstens 40 Zeichen/);
  assert.equal(valueOf("Ä".repeat(40)), "Ä".repeat(40));
  assert.equal(valueOf("😀".repeat(40)), "😀".repeat(40));
  assert.match(errorOf("😀".repeat(41)), /höchstens 40 Zeichen/);
});

test("Steuerzeichen werden abgelehnt", () => {
  for (const input of ["A\tB", "A\nB", "A\u007FB"]) {
    assert.match(errorOf(input), /Zeilenumbrüche, Tabulatoren oder unsichtbaren Zeichen/);
  }
});

test("Nicht-Strings werden abgelehnt", () => {
  for (const input of [123, true, {}, []]) assert.equal(errorOf(input), "Ungültige Projektnummer.");
});

test("erkennt fehlende Spalte project_number", () => {
  assert.equal(
    isMissingProjectNumberColumn("Could not find the 'project_number' column of 'projects' in the schema cache"),
    true,
  );
  assert.equal(isMissingProjectNumberColumn("column projects.project_number does not exist"), true);
  assert.equal(isMissingProjectNumberColumn("Could not find the 'egrid' column of 'projects' in the schema cache"), false);
  assert.equal(
    isMissingProjectNumberColumn(
      `duplicate key value violates unique constraint "${PROJECT_NUMBER_UNIQUE_INDEX}"`,
    ),
    false,
  );
  assert.equal(isMissingProjectNumberColumn(undefined), false);
});

test("Eindeutigkeitsverletzung ergibt 409 mit Nummer", () => {
  const r = projectNumberDbError(
    { code: "23505", message: `duplicate key value violates unique constraint "${PROJECT_NUMBER_UNIQUE_INDEX}"` },
    "2024-017",
  );
  assert.equal(r?.status, 409);
  assert.match(r?.message ?? "", /«2024-017»/);
});

test("Eindeutigkeitsverletzung ohne Wert ergibt allgemeine Meldung", () => {
  const r = projectNumberDbError(
    { code: "23505", message: `duplicate key value violates unique constraint "${PROJECT_NUMBER_UNIQUE_INDEX}"` },
    null,
  );
  assert.equal(r?.status, 409);
  assert.equal(r?.message, "Diese Projektnummer ist in Ihrer Organisation bereits vergeben.");
});

test("andere Eindeutigkeitsverletzung wird nicht übersetzt", () => {
  assert.equal(
    projectNumberDbError({ code: "23505", message: 'duplicate key value violates unique constraint "projects_pkey"' }, "X"),
    null,
  );
});

test("Check-Verletzung ergibt 400", () => {
  const r = projectNumberDbError(
    { code: "23514", message: `new row for relation "projects" violates check constraint "${PROJECT_NUMBER_CHECK}"` },
    "X",
  );
  assert.equal(r?.status, 400);
  assert.match(r?.message ?? "", /Ungültige Projektnummer/);
});

test("anderer Code und null ergeben null", () => {
  assert.equal(projectNumberDbError({ code: "42501", message: PROJECT_NUMBER_UNIQUE_INDEX }, "X"), null);
  assert.equal(projectNumberDbError(null, "X"), null);
  assert.equal(projectNumberDbError(undefined, null), null);
});

test("Index- und Constraint-Namen lösen keine bestehenden Fallbacks aus", () => {
  const forbidden = ["egrid", "lv95_", "bfs_number", "zone_", "bauzone", "parcel_number"];
  for (const name of [PROJECT_NUMBER_UNIQUE_INDEX, PROJECT_NUMBER_CHECK]) {
    for (const f of forbidden) assert.equal(name.includes(f), false, `${name} enthält ${f}`);
  }
});

test("Meldungen in Schweizer Schreibweise (kein ß)", () => {
  const messages = [
    errorOf(1),
    errorOf("a".repeat(41)),
    errorOf("A\tB"),
    projectNumberDbError({ code: "23505", message: PROJECT_NUMBER_UNIQUE_INDEX }, "X")?.message,
    projectNumberDbError({ code: "23505", message: PROJECT_NUMBER_UNIQUE_INDEX }, null)?.message,
    projectNumberDbError({ code: "23514", message: PROJECT_NUMBER_CHECK }, "X")?.message,
  ];
  for (const m of messages) {
    assert.ok(m);
    assert.equal(m.includes("ß"), false, m);
  }
});

test("Unicode-Leerzeichen am Rand werden entfernt (JS trim entfernt mehr als btrim)", () => {
  // U+00A0, U+2003, U+3000, U+FEFF, U+2028: alle von String.prototype.trim erfasst,
  // damit bleibt der DB-Check project_number = btrim(project_number) erfüllt.
  for (const ws of [" ", " ", "　", "﻿", " ", "\r\n"]) {
    assert.equal(valueOf(`${ws}2024-017${ws}`), "2024-017", JSON.stringify(ws));
  }
  assert.equal(valueOf("  "), null);
  // Innenliegende Unicode-Leerzeichen bleiben erhalten.
  assert.equal(valueOf("P 12"), "P 12");
});

test("Länge wird nach dem Trimmen gezählt", () => {
  assert.equal(valueOf(`  ${"a".repeat(40)}  `), "a".repeat(40));
});

test("Steuerzeichen am Rand werden getrimmt statt abgelehnt, innen abgelehnt", () => {
  assert.equal(valueOf("\t2024-017\n"), "2024-017");
  assert.match(errorOf("A\u0000B"), /Zeilenumbrüche/);
  assert.match(errorOf("A\u001FB"), /Zeilenumbrüche/);
});

test("Indexname nur in details wird ebenfalls erkannt", () => {
  const r = projectNumberDbError(
    { code: "23505", message: "duplicate key value", details: `constraint ${PROJECT_NUMBER_UNIQUE_INDEX}` },
    "X",
  );
  assert.equal(r?.status, 409);
});

test("23505/23514 ohne Indexnamen oder mit message/details null ergeben null", () => {
  assert.equal(projectNumberDbError({ code: "23505", message: null, details: null }, "X"), null);
  assert.equal(projectNumberDbError({ code: "23514", message: 'violates check constraint "projects_status_check"' }, "X"), null);
  assert.equal(projectNumberDbError({ code: null, message: PROJECT_NUMBER_UNIQUE_INDEX }, "X"), null);
});

test("Check-Meldung unabhängig vom Wert (value null)", () => {
  const r = projectNumberDbError({ code: "23514", message: PROJECT_NUMBER_CHECK }, null);
  assert.equal(r?.status, 400);
});

test("Konfliktmeldungen lösen keine Spalten-Fallbacks aus", () => {
  const dup = `duplicate key value violates unique constraint "${PROJECT_NUMBER_UNIQUE_INDEX}"`;
  const chk = `new row for relation "projects" violates check constraint "${PROJECT_NUMBER_CHECK}"`;
  for (const m of [dup, chk]) {
    assert.equal(isMissingProjectNumberColumn(m), false, m);
    for (const f of ["egrid", "lv95_", "bfs_number", "zone_", "bauzone", "parcel_number"]) {
      assert.equal(m.includes(f), false, `${m} enthält ${f}`);
    }
  }
});

test("parseProjectNumber: C1-Steuerzeichen und unsichtbare Zeichen werden abgelehnt", () => {
  for (const input of ["AB", "AB", "2024-017​", "A‍B", "A⁠B"]) {
    assert.match(errorOf(input), /unsichtbaren Zeichen/);
  }
});
