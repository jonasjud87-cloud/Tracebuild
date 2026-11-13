import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TAB, hashForTab, isLegacyOerebHash, nextTab, tabFromHash } from "./norms-tabs";

test("tabFromHash: bekannte Anker öffnen den passenden Reiter", () => {
  assert.equal(tabFromHash("#norm-watch"), "quellen");
  assert.equal(tabFromHash("#quellen"), "quellen");
  assert.equal(tabFromHash("#bibliothek"), "bibliothek");
  assert.equal(tabFromHash("#Organisationen"), "organisationen");
});

test("tabFromHash: ohne oder mit unbekanntem Anker gilt der Standard-Reiter", () => {
  assert.equal(tabFromHash(""), DEFAULT_TAB);
  assert.equal(tabFromHash("#irgendwas"), DEFAULT_TAB);
  assert.equal(tabFromHash("#oereb"), DEFAULT_TAB);
});

test("der alte Anker #oereb wird erkannt, damit er weitergeleitet werden kann", () => {
  assert.equal(isLegacyOerebHash("#OEREB"), true);
  assert.equal(isLegacyOerebHash("#bibliothek"), false);
});

test("hashForTab: Hash und Reiter passen zusammen, auch für den Link aus der Glocke", () => {
  assert.equal(hashForTab("quellen"), "#norm-watch");
  assert.equal(tabFromHash(hashForTab("organisationen")), "organisationen");
});

test("nextTab: läuft vorwärts und rückwärts im Kreis", () => {
  assert.equal(nextTab("bibliothek", 1), "quellen");
  assert.equal(nextTab("organisationen", 1), "bibliothek");
  assert.equal(nextTab("bibliothek", -1), "organisationen");
});
