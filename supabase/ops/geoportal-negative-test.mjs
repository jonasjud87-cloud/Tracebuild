#!/usr/bin/env node
/**
 * Negativtest der Geoportal-Migration mit echtem Nutzer-JWT: Was darf ein Client über PostgREST?
 * Nicht automatisch ausführen. Von Hand starten, nachdem die Migration eingespielt ist.
 *
 *   SUPABASE_URL=...  SUPABASE_ANON_KEY=...  USER_JWT=...  \
 *   OWN_PROJECT_ID=<eigenes Testprojekt>  FOREIGN_PROJECT_ID=<Projekt einer fremden Org>  \
 *   node supabase/ops/geoportal-negative-test.mjs
 *
 * Verändert höchstens das eigene Testprojekt: Dessen Name muss «test» enthalten, sonst bricht das Skript
 * ab. Greift ein Schutz nicht, kann ein Schreibversuch wirken; das Skript setzt dann zurück, was es
 * kann, und meldet es. Gibt nie Schlüssel aus. Exit-Code 0 nur, wenn alles bestanden ist.
 */

const NIL = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARK = "__negativtest__";

const { SUPABASE_URL, SUPABASE_ANON_KEY, USER_JWT, OWN_PROJECT_ID: OWN, FOREIGN_PROJECT_ID: FOREIGN } = process.env;

function fatal(message) {
  console.error(`Abbruch: ${message}`);
  process.exit(2);
}

for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, USER_JWT, OWN_PROJECT_ID: OWN, FOREIGN_PROJECT_ID: FOREIGN })) {
  if (!value) fatal(`Umgebungsvariable ${name} fehlt`);
}
if (!UUID.test(OWN) || !UUID.test(FOREIGN)) fatal("OWN_PROJECT_ID und FOREIGN_PROJECT_ID müssen UUIDs sein");
if (OWN === FOREIGN) fatal("Eigenes und fremdes Projekt sind identisch");

const BASE = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;

async function call(method, path, { body, prefer } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${USER_JWT}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    // keine JSON-Antwort: bleibt null
  }
  return { status: res.status, json, code: json && !Array.isArray(json) ? json.code ?? null : null };
}

const REP = "return=representation";
const results = [];

function report(step, passed, detail) {
  results.push(passed);
  console.log(`${passed ? "BESTANDEN      " : "NICHT BESTANDEN"}  ${step}${detail ? `  (${detail})` : ""}`);
}

/** Antwort kurz für die Ausgabe, nur Status und Fehlercode. */
const brief = (r) => `HTTP ${r.status}${r.code ? `, Code ${r.code}` : ""}`;
const denied = (r) => r.status === 403 && r.code === "42501";
const isEmpty = (r) => r.status === 200 && Array.isArray(r.json) && r.json.length === 0;

async function main() {
  const IDENTITY = "id,name,org_id,egrid,bfs_number,lv95_e,lv95_n,location";
  const before = await call("GET", `projects?id=eq.${OWN}&select=${IDENTITY}`);
  if (before.status !== 200 || !Array.isArray(before.json) || before.json.length !== 1) {
    fatal(`Eigenes Projekt nicht lesbar (${brief(before)}). JWT und OWN_PROJECT_ID prüfen.`);
  }
  const own = before.json[0];
  if (!/test/i.test(own.name ?? "")) fatal("Der Name des eigenen Projekts muss «test» enthalten");

  const readOwn = async () => (await call("GET", `projects?id=eq.${OWN}&select=${IDENTITY}`)).json?.[0] ?? null;
  const same = (a, b) => a && b && ["egrid", "bfs_number", "lv95_e", "lv95_n"].every((k) => String(a[k]) === String(b[k]));

  // a) Identität per PATCH
  {
    const r = await call("PATCH", `projects?id=eq.${OWN}`, {
      body: { bfs_number: 9999, egrid: "CH999999999999", lv95_e: 2600000 },
      prefer: REP,
    });
    const after = await readOwn();
    report("a) PATCH Identität des eigenen Projekts: 200, Werte unverändert", r.status === 200 && same(own, after), brief(r));
    if (!same(own, after)) {
      await call("PATCH", `projects?id=eq.${OWN}`, { body: { bfs_number: own.bfs_number, egrid: own.egrid, lv95_e: own.lv95_e } });
    }
  }

  // b) Identität per POST, Testprojekt danach löschen
  {
    const r = await call("POST", "projects", {
      body: { name: MARK, org_id: own.org_id, domain: "bau", status: "active", location: {}, egrid: "CH999999999999", bfs_number: 9999, lv95_e: 2600000, lv95_n: 1200000 },
      prefer: REP,
    });
    const row = Array.isArray(r.json) ? r.json[0] : null;
    const clean = row && row.egrid === null && row.bfs_number === null && row.lv95_e === null && row.lv95_n === null;
    report("b) POST Projekt mit EGRID: 201, Identität null", r.status === 201 && !!clean, brief(r));
    if (row?.id) {
      const d = await call("DELETE", `projects?id=eq.${row.id}&name=eq.${MARK}`, { prefer: REP });
      const gone = await call("GET", `projects?id=eq.${row.id}&select=id`);
      report("b) Testprojekt wieder gelöscht", isEmpty(gone), brief(d));
    }
  }

  // c) Scheinkanton
  {
    const r = await call("PATCH", `projects?id=eq.${OWN}`, { body: { location: { ...own.location, canton: "EVIL" } } });
    const after = await readOwn();
    const kept = JSON.stringify(after?.location) === JSON.stringify(own.location);
    report("c) PATCH location.canton='EVIL': 400, Code 22023", r.status === 400 && r.code === "22023" && kept, brief(r));
    if (!kept) await call("PATCH", `projects?id=eq.${OWN}`, { body: { location: own.location } });
  }

  // d) Schreiben auf Auszug und Themen. PATCH und DELETE treffen über die Null-UUID nie eine echte Zeile.
  {
    const posts = {
      oereb_extracts: { project_id: OWN, canton: "ZH", status: "ok", egrid: "CH999999999999" },
      oereb_themes: { extract_id: NIL, theme_code: MARK, theme_name: MARK, concern: "affects" },
    };
    const keys = { oereb_extracts: "project_id", oereb_themes: "extract_id" };
    for (const table of Object.keys(posts)) {
      const filter = `${table}?${keys[table]}=eq.${NIL}`;
      const post = await call("POST", table, { body: posts[table] });
      report(`d) POST ${table}: 403, Code 42501`, denied(post), brief(post));
      const patch = await call("PATCH", filter, { body: { [table === "oereb_extracts" ? "status" : "theme_name"]: MARK } });
      report(`d) PATCH ${table}: 403, Code 42501`, denied(patch), brief(patch));
      const del = await call("DELETE", filter);
      report(`d) DELETE ${table}: 403, Code 42501`, denied(del), brief(del));
    }
  }

  // e) Lesen
  {
    const mine = await call("GET", `oereb_extracts?project_id=eq.${OWN}&select=id`);
    report("e) GET eigener Auszug: 200", mine.status === 200 && Array.isArray(mine.json), `${brief(mine)}, ${mine.json?.length ?? 0} Zeilen`);
    const theirs = await call("GET", `oereb_extracts?project_id=eq.${FOREIGN}&select=id`);
    report("e) GET fremder Auszug: []", isEmpty(theirs), brief(theirs));
  }

  // f) Tabellen nur für den Server
  {
    const posts = {
      oereb_documents: { canton: "ZH", bfs_number: 9999, municipality: MARK, url: `https://${MARK}.ch`, url_normalized: `https://${MARK}.ch`, title: MARK, title_key: MARK },
      oereb_import_filters: { scope: MARK, rules: {} },
      norm_versions: { norm_id: NIL, title: MARK, text: MARK, text_sha256: MARK },
    };
    for (const [table, body] of Object.entries(posts)) {
      const get = await call("GET", `${table}?select=*&limit=1`);
      report(`f) GET ${table}: []`, isEmpty(get), brief(get));
      const post = await call("POST", table, { body });
      report(`f) POST ${table}: 403`, post.status === 403, brief(post));
    }
  }

  // g) Globale Normen
  {
    const post = await call("POST", "norms", {
      body: { title: MARK, org_id: null, domain: "bau", layer: 4, jurisdiction_type: "municipal", jurisdiction_name: MARK, category: MARK, text: MARK },
      prefer: REP,
    });
    report("g) POST norms mit org_id null: 403", post.status === 403, brief(post));
    const created = Array.isArray(post.json) ? post.json[0] : null;
    if (created?.id) {
      const d = await call("DELETE", `norms?id=eq.${created.id}&title=eq.${MARK}`);
      console.log(`    Achtung: Testnorm wurde angelegt, Löschversuch ergab ${brief(d)}. Bitte «${MARK}» in norms prüfen.`);
    }

    const list = await call("GET", "norms?org_id=is.null&select=id,category&limit=1");
    const target = Array.isArray(list.json) ? list.json[0] : null;
    if (!target) {
      report("g) PATCH globale Norm: keine Änderung", false, `keine globale Norm lesbar, ${brief(list)}`);
    } else {
      const patch = await call("PATCH", `norms?id=eq.${target.id}`, { body: { category: MARK }, prefer: REP });
      const after = await call("GET", `norms?id=eq.${target.id}&select=category`);
      const unchanged = after.json?.[0]?.category === target.category;
      report("g) PATCH globale Norm: keine Änderung", unchanged, brief(patch));
      if (!unchanged) {
        const undo = await call("PATCH", `norms?id=eq.${target.id}`, { body: { category: target.category } });
        console.log(`    Achtung: Kategorie wurde geändert, Rücksetzung ergab ${brief(undo)}.`);
      }
    }
  }

  // h) RPC. Zielt auf das eigene Testprojekt, damit ein fehlendes Recht nicht hinter einem FK-Fehler verschwindet.
  {
    const r = await call("POST", "rpc/replace_oereb_extract", {
      body: { p_project_id: OWN, p_extract: { canton: "ZH", egrid: "CH999999999999", raw: {} }, p_themes: [] },
    });
    report("h) POST rpc/replace_oereb_extract: kein 2xx", r.status < 200 || r.status >= 300, brief(r));
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} von ${results.length} bestanden.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  // Nur die Meldung: Sie enthält weder Header noch Schlüssel.
  fatal(e instanceof Error ? e.message : "unbekannter Fehler");
});
