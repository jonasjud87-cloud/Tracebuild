import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TAB, hashForTab, nextTab, tabFromHash } from "./norms-tabs";

test("tabFromHash: bekannte Anker öffnen den passenden Reiter", () => {
  assert.equal(tabFromHash("#norm-watch"), "quellen");
  assert.equal(tabFromHash("#quellen"), "quellen");
  assert.equal(tabFromHash("#bibliothek"), "bibliothek");
  assert.equal(tabFromHash("#organisationen"), "organisationen");
  assert.equal(tabFromHash("#OEREB"), "oereb");
});

test("tabFromHash: ohne oder mit unbekanntem Anker gilt der Standard-Reiter", () => {
  assert.equal(tabFromHash(""), DEFAULT_TAB);
  assert.equal(tabFromHash("#irgendwas"), DEFAULT_TAB);
});

test("hashForTab: Hash und Reiter passen zusammen, auch für den Link aus der Glocke", () => {
  assert.equal(hashForTab("quellen"), "#norm-watch");
  assert.equal(tabFromHash(hashForTab("organisationen")), "organisationen");
});

test("nextTab: läuft vorwärts und rückwärts im Kreis", () => {
  assert.equal(nextTab("bibliothek", 1), "quellen");
  assert.equal(nextTab("oereb", 1), "bibliothek");
  assert.equal(nextTab("bibliothek", -1), "oereb");
});
