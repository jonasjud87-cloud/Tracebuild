import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type * as tls from "node:tls";
import { probeTls } from "./tls";
import { MonitorError } from "./http";

class FakeSocket extends EventEmitter {
  authorized = true;
  destroyed = false;
  cert: Record<string, unknown> = {};
  getPeerCertificate() {
    return this.cert;
  }
  destroy() {
    this.destroyed = true;
  }
}

function connectWith(setup: (s: FakeSocket) => void, seen: tls.ConnectionOptions[] = []) {
  const s = new FakeSocket();
  const connect = (opts: tls.ConnectionOptions) => {
    seen.push(opts);
    setImmediate(() => setup(s));
    return s as unknown as tls.TLSSocket;
  };
  return { s, connect };
}

test("TLS: liest valid_to und Aussteller, SNI gesetzt, Socket geschlossen", async () => {
  const seen: tls.ConnectionOptions[] = [];
  const { s, connect } = connectWith(sock => {
    sock.cert = { valid_to: "Jan 20 12:00:00 2027 GMT", issuer: { O: "Let's Encrypt" } };
    sock.emit("secureConnect");
  }, seen);
  const info = await probeTls("www.tracebuild.ch", 443, 1000, connect);
  assert.deepEqual(info, { validTo: "2027-01-20T12:00:00.000Z", authorized: true, issuer: "Let's Encrypt" });
  assert.equal(seen[0].servername, "www.tracebuild.ch");
  assert.equal(s.destroyed, true);
});

test("TLS: Fehler und Zeitüberschreitung → MonitorError", async () => {
  const err = connectWith(sock => sock.emit("error", new Error("ECONNREFUSED 1.2.3.4")));
  await assert.rejects(probeTls("x.ch", 443, 1000, err.connect), (e: unknown) => e instanceof MonitorError && e.message === "TLS-Verbindung fehlgeschlagen");
  const silent = connectWith(() => undefined);
  await assert.rejects(probeTls("x.ch", 443, 20, silent.connect), (e: unknown) => e instanceof MonitorError && /Zeitüberschreitung/.test(e.message));
  assert.equal(silent.s.destroyed, true);
});

test("TLS: unlesbares valid_to wird abgelehnt statt zu hängen", async () => {
  const { s, connect } = connectWith(sock => {
    sock.cert = { valid_to: "kein Datum" };
    sock.emit("secureConnect");
  });
  await assert.rejects(probeTls("www.tracebuild.ch", 443, 1000, connect), (e: unknown) => e instanceof MonitorError && /unlesbar/.test(e.message));
  assert.equal(s.destroyed, true);
});
