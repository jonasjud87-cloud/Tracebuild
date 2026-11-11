/** Prompt und Ersatznorm je Land: Für Liechtenstein nie «Schweizer» Recht. Kein Modellaufruf. */
import { test } from "node:test";
import assert from "node:assert/strict";

// lib/anthropic legt beim Import einen Client an; ohne Schlüssel scheitert das. Es wird nichts aufgerufen.
process.env.ANTHROPIC_API_KEY ??= "test-ohne-aufruf";

const ctx = { municipality: "Vaduz", canton: "FL", bauzone: "W2" };

test("Systemprompt: FL ohne Schweizer Rolle und ohne «Kanton FL», CH unverändert", async () => {
  const { buildSystemPrompt } = await import("./analysis-engine");
  const fl = buildSystemPrompt(ctx as Parameters<typeof buildSystemPrompt>[0], "GRENZE");
  assert.match(fl, /^Du bist ein Baurechtsexperte für Liechtenstein/);
  assert.ok(!fl.includes("Schweizer Baurechtsexperte"));
  assert.match(fl, /- Land: Fürstentum Liechtenstein \(kein Schweizer Kanton\)/);
  assert.ok(!fl.includes("- Kanton: FL"));

  const ch = buildSystemPrompt({ ...ctx, municipality: "Mels", canton: "SG" } as Parameters<typeof buildSystemPrompt>[0], "GRENZE");
  assert.match(ch, /^Du bist ein Schweizer Baurechtsexperte/);
  assert.match(ch, /- Kanton: SG\n/);
});

test("Ersatznorm: FL eigenes Baurecht, sonst Schweizer Vorschriften", async () => {
  const { selectNorms, fallbackNormFor } = await import("./analysis-stages/prepare");
  const fl = selectNorms([], null, null, "org", "FL");
  assert.equal(fl.source, "fallback");
  assert.equal(fl.norms[0].title, "Allgemeine Bauvorschriften Liechtenstein");
  assert.ok(!fl.norms[0].text.includes("Schweizer"));
  assert.equal(selectNorms([], null, null, "org").norms[0].title, "Allgemeine Schweizer Bauvorschriften");
  assert.equal(fallbackNormFor("ZH").title, "Allgemeine Schweizer Bauvorschriften");
  assert.equal(fallbackNormFor(null).title, "Allgemeine Schweizer Bauvorschriften");
});
