#!/usr/bin/env node
/**
 * Negativtest der Migrationen 20261106 bis 20261109 mit echtem Nutzer-JWT: Was darf ein Client über PostgREST?
 * Nicht automatisch ausführen. Von Hand starten, nachdem die Migrationen eingespielt sind.
 *
 *   SUPABASE_URL=...  SUPABASE_ANON_KEY=...  USER_JWT=...  \
 *   OWN_PROJECT_ID=<eigenes Testprojekt>  FOREIGN_PROJECT_ID=<Projekt einer fremden Org>  \
 *   SUPABASE_SERVICE_ROLE_KEY=...  \
 *   node supabase/ops/geoportal-negative-test.mjs
 *
 * Verändert höchstens das eigene Testprojekt: Dessen Name muss «test» enthalten, sonst bricht das Skript
 * ab. Greift ein Schutz nicht, kann ein Schreibversuch wirken; das Skript setzt dann zurück, was es
 * kann, und meldet es. Gibt nie Schlüssel aus. Exit-Code 0 nur, wenn alles bestanden ist.
 *
 * Einzige Ausnahme: Schritt i legt eine Testnorm der eigenen Org an, um den Schutz-Trigger zu prüfen. Auf
 * norms gibt es keine DELETE-Policy, der Client kann sie also nicht selbst löschen. Dafür und nur dafür
 * dient SUPABASE_SERVICE_ROLE_KEY. Fehlt er, legt das Skript keine Norm an und meldet OHNE BEWEIS.
 *
 * OHNE BEWEIS: Die Sperre wurde nicht belegt (z. B. 0 Zeilen bei Null-UUID oder ein Fehler vor der
 * Rechteprüfung). Zählt nicht als bestanden, der Exit-Code ist dann 1.
 * Ein [] beim fremden Projekt sagt nur etwas, wenn dieses Projekt Dokumente und Analysen hat.
 */

import { randomUUID } from "node:crypto";

const NIL = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARK = "__negativtest__";

const { SUPABASE_URL, SUPABASE_ANON_KEY, USER_JWT, OWN_PROJECT_ID: OWN, FOREIGN_PROJECT_ID: FOREIGN, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } = process.env;

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

async function call(method, path, { body, prefer, asService } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: {
      apikey: asService ? SERVICE_KEY : SUPABASE_ANON_KEY,
      Authorization: `Bearer ${asService ? SERVICE_KEY : USER_JWT}`,
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
const is2xx = (r) => r.status >= 200 && r.status < 300;

let unprovenCount = 0;

/** Sperre nicht belegt: zählt nicht als bestanden, ist aber auch kein durchgekommener Schreibversuch. */
function unproven(step, detail) {
  results.push(false);
  unprovenCount += 1;
  console.log(`OHNE BEWEIS      ${step}  (${detail})`);
}

/**
 * Bewertet einen Schreibversuch. Nur 42501 belegt die Sperre. Mit `rlsOnly` gibt es keinen REVOKE, dort sind
 * 0 Zeilen das erwartete Ergebnis und werden als schwacher Beleg ausgewiesen.
 */
function judgeWrite(step, r, { rlsOnly = false } = {}) {
  if (denied(r)) return report(step, true, `${brief(r)}, abgewiesen`);
  if (!is2xx(r)) return unproven(step, `${brief(r)}, nicht 42501: Rechteprüfung nicht belegt`);
  if (isEmpty(r)) {
    if (rlsOnly) return report(step, true, `${brief(r)}, 0 Zeilen: nur RLS ohne REVOKE, schwacher Beleg`);
    return unproven(step, `${brief(r)}, 0 Zeilen bei Null-UUID: erwartet war 42501`);
  }
  return report(step, false, `${brief(r)}, Schreibversuch durchgekommen`);
}

/** Bewertet einen RPC-Aufruf. Ein anderer Fehler als 42501 (z. B. PGRST202) belegt die Sperre nicht. */
function judgeRpc(step, r) {
  if (denied(r)) return report(step, true, `${brief(r)}, abgewiesen`);
  if (!is2xx(r)) return unproven(step, `${brief(r)}, kein 2xx, aber nicht 42501: Rechteprüfung nicht belegt`);
  return report(step, false, `${brief(r)}, Aufruf durchgekommen`);
}

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

  // i) Schutz-Trigger auf norms. Zuerst ohne Spur prüfen, ob der Client anlegen darf: title null scheitert erst
  // an NOT NULL (23502), und das kommt nach Rechte- und RLS-Prüfung (42501). So entsteht dabei keine Zeile.
  {
    const base = { org_id: own.org_id, domain: "bau", layer: 5, jurisdiction_type: "org", jurisdiction_name: MARK, category: MARK, text: MARK };
    const step = "i) POST norms mit Systemfeldern";
    const probe = await call("POST", "norms", { body: { ...base, title: null }, prefer: REP });
    if (denied(probe)) {
      report(`${step}: Client darf gar nicht anlegen`, true, `${brief(probe)}, Trigger damit nicht erreichbar und nicht geprüft`);
    } else if (probe.code !== "23502") {
      unproven(step, `Vorprüfung ergab ${brief(probe)}, erwartet 42501 oder 23502`);
    } else if (!SERVICE_KEY) {
      unproven(step, "Client darf anlegen, aber nicht löschen; ohne SUPABASE_SERVICE_ROLE_KEY keine Testnorm angelegt");
    } else {
      // Null-UUID in superseded_by_norm_id: Ohne Trigger scheitert der Insert am Fremdschlüssel und es bleibt keine Zeile.
      const title = `${MARK}${randomUUID()}`;
      const r = await call("POST", "norms", {
        body: {
          ...base,
          title,
          org_authoritative: true,
          superseded_by_norm_id: NIL,
          org_authoritative_by: NIL,
          source_kind: "oereb_auto",
          auto_scope: "parcel",
          text_read_by_ai: true,
        },
        prefer: REP,
      });
      const created = Array.isArray(r.json) ? r.json[0] : null;
      if (created?.id) {
        try {
          const fields = "org_authoritative,superseded_by_norm_id,org_authoritative_by,source_kind,auto_scope,text_read_by_ai";
          const stored = (await call("GET", `norms?id=eq.${created.id}&select=${fields}`)).json?.[0] ?? null;
          const set = !stored
            ? ["Zeile nicht lesbar"]
            : fields.split(",").filter((k) => (k === "org_authoritative" || k === "text_read_by_ai" ? stored[k] !== false : stored[k] !== null));
          report(`${step}: 201, Werte nicht gesetzt`, r.status === 201 && set.length === 0, set.length ? `${brief(r)}, gesetzt: ${set.join(", ")}` : brief(r));
        } finally {
          // Nur diese eine Norm: Kennung, Testtitel und eigene Org müssen zusammen passen.
          const d = await call("DELETE", `norms?id=eq.${created.id}&title=eq.${title}&org_id=eq.${own.org_id}`, { prefer: REP, asService: true });
          const gone = await call("GET", `norms?id=eq.${created.id}&select=id`);
          report("i) Testnorm wieder gelöscht", isEmpty(gone), brief(d));
          if (!isEmpty(gone)) console.log(`    Achtung: Testnorm ${created.id} besteht noch. Bitte in norms entfernen.`);
        }
      } else if (r.code === "23503") {
        report(step, false, `${brief(r)}: Fremdschlüssel griff, Trigger hat superseded_by_norm_id nicht geleert`);
      } else if (denied(r)) {
        report(`${step}: abgewiesen`, true, brief(r));
      } else {
        unproven(step, `${brief(r)}, keine Zeile entstanden: Trigger nicht geprüft`);
      }
    }
  }

  // j) Nur Lesen. PATCH und DELETE filtern ausschliesslich auf die Null-UUID, POST verweist auf die Null-UUID
  // und scheitert spätestens am Fremdschlüssel: Auch ein durchgekommener Schreibversuch trifft keine echte Zeile.
  {
    const tables = {
      analyses: {
        post: { document_id: NIL, status: MARK },
        patch: { status: MARK },
        select: "id,documents!inner(project_id)",
        scope: "documents.project_id",
      },
      documents: {
        post: { project_id: NIL, file_url: MARK },
        patch: { doc_type: MARK },
        select: "id",
        scope: "project_id",
      },
      document_files: {
        post: { document_id: NIL, storage_path: MARK, file_name: MARK, mime_type: MARK },
        patch: { file_name: MARK },
        select: "id,documents!inner(project_id)",
        scope: "documents.project_id",
      },
      analysis_items: {
        post: { analysis_id: NIL, status: MARK, note: MARK },
        patch: { note: MARK },
        select: "id,analyses!inner(documents!inner(project_id))",
        scope: "analyses.documents.project_id",
      },
      project_norms: {
        post: { project_id: NIL, norm_id: NIL, added_by: MARK },
        patch: { added_by: MARK },
        select: "id",
        scope: "project_id",
      },
    };
    for (const [table, t] of Object.entries(tables)) {
      const filter = `${table}?id=eq.${NIL}`;
      judgeWrite(`j) POST ${table}: 403, Code 42501`, await call("POST", table, { body: t.post, prefer: REP }));
      judgeWrite(`j) PATCH ${table}: 403, Code 42501`, await call("PATCH", filter, { body: t.patch, prefer: REP }));
      judgeWrite(`j) DELETE ${table}: 403, Code 42501`, await call("DELETE", filter, { prefer: REP }));

      const mine = await call("GET", `${table}?select=${t.select}&${t.scope}=eq.${OWN}&limit=20`);
      const count = mine.json?.length ?? 0;
      report(`j) GET ${table} im eigenen Projekt: 200`, mine.status === 200 && Array.isArray(mine.json), `${brief(mine)}, ${count} Zeilen${count === 0 ? ": Lesen ohne Daten nicht belegt" : ""}`);
      const theirs = await call("GET", `${table}?select=${t.select}&${t.scope}=eq.${FOREIGN}&limit=1`);
      report(`j) GET ${table} im fremden Projekt: []`, isEmpty(theirs), brief(theirs));
    }
  }

  // k) Tabellen ohne Zugriffsrechte. Lesen bewusst ohne Filter (nur Schlüsselspalte, wird nicht ausgegeben): Ein []
  // mit Null-UUID sagte nichts. Schreiben nur mit Null-UUID; POST kann nichts anlegen (Fremdschlüssel, NOT NULL).
  // analysis_jobs und analysis_job_parts haben REVOKE ALL. oereb_fetch_events und oereb_ocr_runs haben nur RLS
  // ohne Policy: Dort belegt POST mit 42501 die Sperre, PATCH und DELETE treffen ohne Fehler 0 Zeilen.
  {
    const tables = {
      analysis_jobs: { key: "analysis_id", post: { analysis_id: NIL, project_id: NIL, files: [] }, patch: { run_id: MARK } },
      analysis_job_parts: { key: "analysis_id", post: { analysis_id: NIL, position: 0, unit: {} }, patch: { next_effort: MARK } },
      oereb_fetch_events: { key: "id", filter: "project_id", rlsOnly: true, post: { source: MARK, project_id: NIL, status: null }, patch: { detail: MARK } },
      oereb_ocr_runs: { key: "id", rlsOnly: true, post: { document_id: NIL, reserved_usd: 0 }, patch: { model: MARK } },
    };
    for (const [table, t] of Object.entries(tables)) {
      const get = await call("GET", `${table}?select=${t.key}&limit=1`);
      report(`k) GET ${table}: [] oder 403`, isEmpty(get) || denied(get), brief(get));

      const filter = `${table}?${t.filter ?? t.key}=eq.${NIL}`;
      judgeWrite(`k) POST ${table}: 403, Code 42501`, await call("POST", table, { body: t.post, prefer: REP }));
      const expected = t.rlsOnly ? "abgewiesen oder 0 Zeilen" : "403, Code 42501";
      judgeWrite(`k) PATCH ${table}: ${expected}`, await call("PATCH", filter, { body: t.patch, prefer: REP }), { rlsOnly: t.rlsOnly });
      judgeWrite(`k) DELETE ${table}: ${expected}`, await call("DELETE", filter, { prefer: REP }), { rlsOnly: t.rlsOnly });
    }
  }

  // l) RPC nur für den Server. 20261107 legt keine RPC an. Alle Argumente sind so gewählt, dass auch ein durchgekommener
  // Aufruf nichts anrichtet. analysis_dispatch nie ohne Argument: Das wäre der Wächter-Lauf über alle Jobs.
  {
    const rpcs = {
      analysis_claim_stage: { p_analysis_id: NIL, p_token_hash: MARK, p_lease_id: NIL, p_lease_seconds: 1 },
      analysis_release_stage: { p_analysis_id: NIL, p_lease_id: NIL, p_delay_seconds: 0 },
      analysis_dispatch: { p_analysis_id: NIL },
      analysis_background_available: {},
      // Null-UUID, die keine Gemeinde trifft: endet in `conflict`.
      oereb_apply_version_actions: {
        p_canton: MARK,
        p_bfs: 0,
        p_actions: [{ doc_id: NIL, expect_status: MARK, expect_reason: MARK, patch: {} }],
      },
      // Budget 0: endet vor dem Insert in `daily`, es entsteht keine Reservation.
      oereb_ocr_reserve: { p_document_id: NIL, p_pdf_sha256: MARK, p_model: MARK, p_reserve_usd: 1, p_daily_budget_usd: 0, p_document_max_usd: 0 },
    };
    for (const [name, body] of Object.entries(rpcs)) {
      judgeRpc(`l) POST rpc/${name}: 403, Code 42501`, await call("POST", `rpc/${name}`, { body }));
    }
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} von ${results.length} bestanden${unprovenCount ? `, ${unprovenCount} ohne Beweis` : ""}.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  // Nur die Meldung: Sie enthält weder Header noch Schlüssel.
  fatal(e instanceof Error ? e.message : "unbekannter Fehler");
});
