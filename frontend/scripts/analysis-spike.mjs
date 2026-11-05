#!/usr/bin/env node
// Spike «Analyse in Etappen», löst Jonas aus. Anleitung: supabase/ops/analysis-stages-activate.sql.
// Aufruf: SPIKE_ORIGIN=https://www.tracebuild.ch SPIKE_SECRET=... node scripts/analysis-spike.mjs [--runs 10] [--work-ms 280000]
// Prüft die Antworten. Ob waitUntil trug, steht im Vercel-Log (analysis-spike.done, analysis-spike.hop).
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const origin = (process.env.SPIKE_ORIGIN ?? "").replace(/\/+$/, "");
const secret = process.env.SPIKE_SECRET ?? "";
if (!origin || !secret) {
  console.error("SPIKE_ORIGIN und SPIKE_SECRET setzen.");
  process.exit(2);
}
const runs = arg("--runs", 10);
const workMs = arg("--work-ms", 280_000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(hops) {
  const started = Date.now();
  const res = await fetch(`${origin}/api/v1/internal/analysis-spike`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", "x-analysis-spike-secret": secret },
    body: JSON.stringify({ work_ms: workMs, hops }),
  });
  const body = await res.text();
  return { status: res.status, ms: Date.now() - started, id: res.status === 202 ? JSON.parse(body).id : null };
}

let good = 0;
for (let i = 1; i <= runs; i++) {
  const r = await call(0);
  const ok = r.status === 202 && r.ms < 5_000;
  if (ok) good++;
  console.log(`${i}/${runs}: Status ${r.status}, ${r.ms} ms, ${ok ? "ok" : "FEHLER"}${r.id ? `, id ${r.id}` : ""}`);
  if (i < runs) await sleep(workMs + 15_000);
}
console.log(`Antworten: ${good}/${runs} mit 202 unter 5 s.`);

console.log("Sprung über www:");
const hop = await call(1);
console.log(`Status ${hop.status}, ${hop.ms} ms, id ${hop.id ?? "-"}.`);
console.log(`In ${Math.round((2 * workMs + 15_000) / 60_000)} Minuten im Vercel-Log prüfen: ${runs + 2}-mal analysis-spike.done, einmal analysis-spike.hop mit status 202.`);
process.exit(good === runs && hop.status === 202 ? 0 : 1);
