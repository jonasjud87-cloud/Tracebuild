export function fmtInt(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("de-CH") : "–";
}

export function fmtBytes(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("de-CH", { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}

export function fmtQuota(used: number | null, limit: number | null | undefined, unit: (n: number) => string = fmtInt): string {
  const u = used === null ? "–" : unit(used);
  if (limit === null) return `${u} (ohne Limit)`;
  if (limit === undefined) return u;
  return `${u} / ${unit(limit)}`;
}

export function fmtDateTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "–";
}
