/** Chat- und Extraktionsprompts: Für Liechtenstein nie «Kanton FL» oder Schweizer Recht. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chatLawScope, chatPlace } from "./chat-prompt";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("chatPlace: FL als Land, CH als Kanton, leer unbekannt", () => {
  assert.equal(chatPlace("FL"), "Fürstentum Liechtenstein");
  assert.equal(chatPlace("sg"), "Kanton SG");
  assert.equal(chatPlace(null), "Kanton unbekannt");
  assert.equal(chatPlace(""), "Kanton unbekannt");
});

test("chatLawScope: FL ohne Schweizer und kantonales Recht, CH unverändert", () => {
  const fl = chatLawScope("FL");
  assert.match(fl, /Baurecht Liechtensteins/);
  assert.ok(!/Schweizer|kantonal/i.test(fl), fl);
  assert.equal(chatLawScope("ZH"), "Allgemeine Fragen zu Schweizer Baurecht, SIA-Normen und kantonalen Baugesetzen beantworten");
  assert.equal(chatLawScope(undefined), chatLawScope("ZH"));
});

test("Chat-Route nutzt die Helfer, kein festes «Kanton ${kanton}» mehr", () => {
  const route = read("../app/api/v1/projects/[id]/chat/route.ts");
  assert.match(route, /chatPlace\(project\.location\?\.canton\)/);
  assert.match(route, /chatLawScope\(project\.location\?\.canton\)/);
  assert.ok(!route.includes("Kanton ${kanton}"));
});

test("Extraktionsprompts nennen Schweiz oder Liechtenstein", () => {
  assert.match(read("./kenndaten-extraction.ts"), /Baugesetze der Schweiz oder Liechtensteins/);
  assert.match(read("./normenblatt-extraction.ts"), /Zonennormen der Schweiz oder Liechtensteins/);
});
