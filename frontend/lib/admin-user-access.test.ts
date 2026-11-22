/** countOtherActiveSuperAdmins nach Umstellung auf parallele Abfragen. Auth-Modul als Attrappe. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";

interface ResolveResult { url: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context: unknown) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, nextResolve: NextResolve): ResolveResult }): void;
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/auth") {
      const stub = `export const ADMIN_EMAILS = new Set(["boss@example.ch"]);`;
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type Row = { id: string; email: string; role: string };
type AuthUser = { banned_until: string | null } | null;

function fakeAdmin(rows: Row[] | null, auth: Record<string, AuthUser | "error">, usersError = false) {
  const asked: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const client = {
    from: () => ({
      select: async () => (usersError ? { data: null, error: { code: "x" } } : { data: rows, error: null }),
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => {
          asked.push(id);
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise(r => setTimeout(r, 5));
          inFlight--;
          const a = auth[id];
          if (a === "error") return { data: { user: null }, error: { message: "x" } };
          return { data: { user: a ?? null }, error: null };
        },
      },
    },
  };
  return { client, asked, maxInFlight: () => maxInFlight };
}

async function count(f: ReturnType<typeof fakeAdmin>, exclude: string): Promise<number | null> {
  const { countOtherActiveSuperAdmins } = await import("./admin-user-access");
  return countOtherActiveSuperAdmins(f.client as unknown as Parameters<typeof countOtherActiveSuperAdmins>[0], exclude);
}

const ROWS: Row[] = [
  { id: "s1", email: "x@x.ch", role: "super_admin" },
  { id: "s2", email: "BOSS@example.ch", role: "member" },
  { id: "s3", email: "y@x.ch", role: "super_admin" },
  { id: "m1", email: "m@x.ch", role: "org_admin" },
];

test("zählt aktive Super-Admins ausser dem Ausgeschlossenen, Gesperrte nicht", async () => {
  const f = fakeAdmin(ROWS, { s2: { banned_until: null }, s3: { banned_until: "2999-01-01T00:00:00Z" } });
  assert.equal(await count(f, "s1"), 1);
  assert.deepEqual(f.asked.sort(), ["s2", "s3"], "Org-Admin und Ausgeschlossener werden nicht abgefragt");
  assert.equal(f.maxInFlight(), 2, "parallel");
});

test("abgelaufene Sperre zählt als aktiv", async () => {
  const f = fakeAdmin(ROWS, { s2: { banned_until: "2000-01-01T00:00:00Z" }, s3: { banned_until: null } });
  assert.equal(await count(f, "s1"), 2);
});

test("fehlendes Auth-Konto zählt nicht", async () => {
  const f = fakeAdmin(ROWS, { s2: null, s3: { banned_until: null } });
  assert.equal(await count(f, "s1"), 1);
});

test("ein Auth-Fehler ergibt null (unbekannt, Sperre wird verweigert)", async () => {
  const f = fakeAdmin(ROWS, { s2: "error", s3: { banned_until: null } });
  assert.equal(await count(f, "s1"), null);
});

test("Fehler beim Lesen der Nutzer ergibt null", async () => {
  const f = fakeAdmin(null, {}, true);
  assert.equal(await count(f, "s1"), null);
});

test("keine anderen Super-Admins: 0 ohne Auth-Abfragen", async () => {
  const f = fakeAdmin([{ id: "s1", email: "x@x.ch", role: "super_admin" }], {});
  assert.equal(await count(f, "s1"), 0);
  assert.equal(f.asked.length, 0);
});
