export const JSON_LIMIT_BYTES = 2 * 1024 * 1024;
export const XML_LIMIT_BYTES = 25 * 1024 * 1024;
export const PDF_LIMIT_BYTES = 30 * 1024 * 1024;

export async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Antwort der Quelle ist zu gross");

  if (!res.body) {
    const whole = new Uint8Array(await res.arrayBuffer());
    if (whole.length > maxBytes) throw new Error("Antwort der Quelle ist zu gross");
    return whole;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Antwort der Quelle ist zu gross");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function readTextLimited(res: Response, maxBytes: number): Promise<string> {
  return new TextDecoder("utf-8").decode(await readLimited(res, maxBytes));
}

export async function readJsonLimited(res: Response): Promise<unknown> {
  const text = await readTextLimited(res, JSON_LIMIT_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Die Quelle lieferte keine gültige JSON-Antwort");
  }
}

export function assertOrigin(res: Response, prefix: string): void {
  if (res.url && !res.url.startsWith(prefix)) throw new Error("Unerwartete Weiterleitung der Quelle");
}
