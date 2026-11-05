/** Sicherheit des Downloads. fetch und DNS sind Attrappen, kein Netzwerk. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchDocument, isPrivateAddress, isRedirectAllowed } from "./document-fetch";
import { DEFAULT_IMPORT_FILTER as R } from "./import-filter";

const PUBLIC = async () => ["195.65.1.1"];

function pdf(body = "%PDF-1.7 Inhalt", init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

function script(...responses: Response[]) {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    urls.push(url);
    inits.push(init);
    const next = responses.shift();
    if (!next) throw new Error("kein weiterer Request erwartet");
    return next;
  }) as unknown as typeof fetch;
  return { impl, urls, inits };
}

const opts = (impl: typeof fetch, extra = {}) => ({ rules: R, canton: "ZH", fetchImpl: impl, lookupImpl: PUBLIC, ...extra });

test("private Adressen werden erkannt", () => {
  for (const ip of [
    "10.0.0.1", "127.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "100.127.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1",
    "ff02::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:db8::1",
    "keine-ip", "",
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["195.65.1.1", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2a00:1450:4001::1", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("Redirect-Regeln: https nach http nur auf gleichem Host", () => {
  const u = (s: string) => new URL(s);
  assert.equal(isRedirectAllowed(u("https://www.rdppf.vd.ch/a"), u("http://www.rdppf.vd.ch/b")), true);
  assert.equal(isRedirectAllowed(u("https://a.zh.ch/a"), u("http://b.zh.ch/b")), false);
  assert.equal(isRedirectAllowed(u("http://a.zh.ch/a"), u("https://b.zh.ch/b")), true);
  assert.equal(isRedirectAllowed(u("https://a.zh.ch/a"), u("https://b.zh.ch/b")), true);
});

test("Normalfall: PDF, etag, kein Auth-Header, Redirects von Hand", async () => {
  const s = script(pdf("%PDF-1.7 Inhalt", { headers: { etag: '"x"', "last-modified": "gestern" } }));
  const res = await fetchDocument("https://oerebdocs.zh.ch/getDoc?docid=1", opts(s.impl));
  assert.equal(res.kind, "ok");
  if (res.kind === "ok") {
    assert.equal(res.etag, '"x"');
    assert.equal(res.lastModified, "gestern");
    assert.equal(res.bytes.toString(), "%PDF-1.7 Inhalt");
  }
  assert.equal(s.inits[0].redirect, "manual");
  assert.equal(Object.keys(s.inits[0].headers as object).some((h) => /authorization|cookie/i.test(h)), false);
});

test("Bedingte Abfrage: 304 heisst unverändert", async () => {
  const s = script(new Response(null, { status: 304 }));
  const res = await fetchDocument("https://oerebdocs.zh.ch/1", opts(s.impl, { etag: '"x"', lastModified: "gestern" }));
  assert.equal(res.kind, "not_modified");
  const h = s.inits[0].headers as Record<string, string>;
  assert.equal(h["If-None-Match"], '"x"');
  assert.equal(h["If-Modified-Since"], "gestern");
});

test("fremder Host, falsches Schema, falscher Port, Zugangsdaten: kein Request", async () => {
  for (const url of [
    "https://evil.example.com/a.pdf",
    "https://127.0.0.1/a.pdf",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "ftp://oerebdocs.zh.ch/a",
    "https://oerebdocs.zh.ch:8443/a",
    "https://user:pw@oerebdocs.zh.ch/a",
    "kein url",
  ]) {
    const s = script();
    const res = await fetchDocument(url, opts(s.impl));
    assert.equal(res.kind, "rejected", url);
    if (res.kind === "rejected") assert.equal(res.reason, "host_not_allowed", url);
    assert.equal(s.urls.length, 0, url);
  }
});

test("erlaubter Host auf private Adresse: gesperrt, auch wenn nur eine von mehreren privat ist", async () => {
  for (const addresses of [["10.0.0.5"], ["195.65.1.1", "127.0.0.1"], ["::1"], []]) {
    const s = script();
    const res = await fetchDocument("https://oerebdocs.zh.ch/a", opts(s.impl, { lookupImpl: async () => addresses }));
    assert.equal(res.kind, "rejected");
    if (res.kind === "rejected") assert.equal(res.reason, "private_address");
    assert.equal(s.urls.length, 0);
  }
});

test("Redirect: jeder Hop wird geprüft", async () => {
  const toEvil = script(redirect("https://evil.example.com/a.pdf"));
  const evil = await fetchDocument("https://oerebdocs.zh.ch/a", opts(toEvil.impl));
  assert.equal(evil.kind === "rejected" && evil.reason, "host_not_allowed");
  assert.equal(toEvil.urls.length, 1);

  const toMeta = script(redirect("http://169.254.169.254/latest"));
  const meta = await fetchDocument("http://www.geo.lu.ch/a", opts(toMeta.impl, { canton: "LU" }));
  assert.equal(meta.kind === "rejected" && meta.reason, "host_not_allowed");

  const rebind = script(redirect("https://intern.zh.ch/a"));
  const res = await fetchDocument("https://oerebdocs.zh.ch/a", opts(rebind.impl, {
    lookupImpl: async (h: string) => (h === "intern.zh.ch" ? ["10.1.1.1"] : ["195.65.1.1"]),
  }));
  assert.equal(res.kind === "rejected" && res.reason, "private_address");
  assert.equal(rebind.urls.length, 1);

  const downgrade = script(redirect("http://andere.zh.ch/a"));
  const down = await fetchDocument("https://oerebdocs.zh.ch/a", opts(downgrade.impl));
  assert.equal(down.kind === "rejected" && down.reason, "host_not_allowed");
});

test("Redirect: VD über http auf gleichem Host, relativ, und höchstens drei", async () => {
  const vd = script(redirect("http://www.rdppf.vd.ch/doc", 307), redirect("/doc2", 303), pdf());
  const ok = await fetchDocument("https://www.rdppf.vd.ch/a", opts(vd.impl, { canton: "VD" }));
  assert.equal(ok.kind, "ok");
  assert.deepEqual(vd.urls, ["https://www.rdppf.vd.ch/a", "http://www.rdppf.vd.ch/doc", "http://www.rdppf.vd.ch/doc2"]);

  const three = script(redirect("/1"), redirect("/2"), redirect("/3"), pdf());
  assert.equal((await fetchDocument("https://oerebdocs.zh.ch/a", opts(three.impl))).kind, "ok");

  const four = script(redirect("/1"), redirect("/2"), redirect("/3"), redirect("/4"));
  const res = await fetchDocument("https://oerebdocs.zh.ch/a", opts(four.impl));
  assert.equal(res.kind === "rejected" && res.reason, "too_many_redirects");
});

test("Grössenlimit: über Content-Length und beim Streamen", async () => {
  const small = { ...R, max_pdf_bytes: 20 };
  const declared = script(pdf("%PDF-1", { headers: { "content-length": "99" } }));
  const a = await fetchDocument("https://oerebdocs.zh.ch/a", { ...opts(declared.impl), rules: small });
  assert.equal(a.kind === "rejected" && a.reason, "too_large");

  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      c.enqueue(Buffer.from(pulled === 1 ? "%PDF-1234567890" : "1234567890"));
    },
  });
  const endless = script(new Response(stream));
  const b = await fetchDocument("https://oerebdocs.zh.ch/a", { ...opts(endless.impl), rules: small });
  assert.equal(b.kind === "rejected" && b.reason, "too_large");
  assert.ok(pulled < 5);
});

test("kein PDF: HTML wird abgelehnt", async () => {
  for (const body of ["<html>WAF</html>", "%PD", "", " %PDF-1.7"]) {
    const s = script(pdf(body));
    const res = await fetchDocument("https://oerebdocs.zh.ch/a", opts(s.impl));
    assert.equal(res.kind === "rejected" && res.reason, "not_pdf", JSON.stringify(body));
  }
});

test("HTTP-Fehler, DNS-Fehler und Timeout sind 'failed', werfen nie", async () => {
  const http = script(new Response("x", { status: 503 }));
  const a = await fetchDocument("https://oerebdocs.zh.ch/a", opts(http.impl));
  assert.equal(a.kind, "failed");

  const dns = await fetchDocument("https://oerebdocs.zh.ch/a", opts(script().impl, {
    lookupImpl: async () => {
      throw new Error("ENOTFOUND");
    },
  }));
  assert.equal(dns.kind, "failed");

  const hang = (async (_u: string, init: RequestInit) =>
    new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Timeout", "TimeoutError")));
    })) as unknown as typeof fetch;
  const c = await fetchDocument("https://oerebdocs.zh.ch/a", opts(hang, { timeoutMs: 10 }));
  assert.equal(c.kind, "failed");
});

test("http nur für belegte Hosts, sonst nur https, auch bei Weiterleitungen", async () => {
  const plain = script();
  const a = await fetchDocument("http://oerebdocs.zh.ch/a", opts(plain.impl));
  assert.equal(a.kind === "rejected" && a.reason, "host_not_allowed");
  assert.equal(plain.urls.length, 0);

  const lu = script(pdf());
  assert.equal((await fetchDocument("http://www.geo.lu.ch/a", opts(lu.impl, { canton: "LU" }))).kind, "ok");

  const hop = script(redirect("http://oerebdocs.zh.ch/b"));
  const b = await fetchDocument("https://oerebdocs.zh.ch/a", opts(hop.impl));
  assert.equal(b.kind === "rejected" && b.reason, "host_not_allowed");
  assert.equal(hop.urls.length, 1);
});
