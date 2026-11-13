import test from "node:test";
import assert from "node:assert/strict";
import { ALL_USERS, EMPTY_FILTER, audienceOptions, filterAnnouncements, isFiltered } from "./filter";
import type { Announcement } from "./types";

function ann(over: Partial<Announcement>): Announcement {
  return {
    id: "1",
    orgId: null,
    orgName: null,
    title: "Wartung am Freitag",
    message: "Die Plattform ist kurz nicht erreichbar.",
    type: "maintenance",
    startsAt: "2026-11-13T00:00:00.000Z",
    endsAt: null,
    dismissible: true,
    active: true,
    createdAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
    createdByEmail: "admin@example.ch",
    state: "live",
    ...over,
  };
}

const ITEMS = [
  ann({ id: "1" }),
  ann({ id: "2", title: "Neue Normen", message: "USG aktualisiert", type: "info", state: "scheduled", orgId: "o1", orgName: "Atelier Drü" }),
  ann({ id: "3", title: "Störung", type: "critical", state: "expired", orgId: "o2", orgName: "Büro Meier" }),
];

test("ohne Filter bleibt alles", () => {
  assert.equal(filterAnnouncements(ITEMS, EMPTY_FILTER).length, 3);
  assert.equal(isFiltered(EMPTY_FILTER), false);
});

test("Suche findet Titel, Text und Organisation ohne Gross-/Kleinschreibung", () => {
  assert.deepEqual(filterAnnouncements(ITEMS, { ...EMPTY_FILTER, query: "wartung" }).map(a => a.id), ["1"]);
  assert.deepEqual(filterAnnouncements(ITEMS, { ...EMPTY_FILTER, query: "usg" }).map(a => a.id), ["2"]);
  assert.deepEqual(filterAnnouncements(ITEMS, { ...EMPTY_FILTER, query: "drü" }).map(a => a.id), ["2"]);
});

test("Status, Art und Zielgruppe lassen sich kombinieren", () => {
  assert.deepEqual(filterAnnouncements(ITEMS, { ...EMPTY_FILTER, state: "live" }).map(a => a.id), ["1"]);
  assert.deepEqual(filterAnnouncements(ITEMS, { ...EMPTY_FILTER, type: "critical" }).map(a => a.id), ["3"]);
  assert.deepEqual(filterAnnouncements(ITEMS, { ...EMPTY_FILTER, audience: ALL_USERS }).map(a => a.id), ["1"]);
  assert.deepEqual(filterAnnouncements(ITEMS, { ...EMPTY_FILTER, audience: "o1", type: "critical" }).length, 0);
});

test("Zielgruppen: Alle Nutzer zuerst, Organisationen alphabetisch", () => {
  const opts = audienceOptions(ITEMS);
  assert.deepEqual(opts.map(o => o.label), ["Alle Nutzer", "Atelier Drü", "Büro Meier"]);
});
