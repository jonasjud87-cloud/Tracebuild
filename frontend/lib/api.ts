const BASE = "/api/v1";

/**
 * Reads the API envelope `{ data, error }`.
 *
 * A crashed route, a 413 or an auth redirect answers with an HTML page, not JSON —
 * parsing that blindly used to surface as `Unexpected token '<'`, which tells the
 * user nothing. So decode the body as text first and only then try JSON.
 */
async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.text();

  let json: { data?: unknown; error?: string; detail?: string };
  try {
    json = JSON.parse(body);
  } catch {
    const hint = body.trim().startsWith("<")
      ? "Der Server hat eine Fehlerseite statt einer Antwort geliefert."
      : body.slice(0, 200);
    throw new Error(`Serverfehler (HTTP ${res.status}). ${hint}`);
  }

  if (!res.ok) throw new Error(json.detail ?? json.error ?? `Fehler (HTTP ${res.status})`);
  if (json.error) throw new Error(json.error);
  return json.data as T;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return unwrap<T>(res);
}

async function requestForm<T>(path: string, formData: FormData, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    body: formData,
    signal,
  });
  return unwrap<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  postForm: <T>(path: string, formData: FormData, signal?: AbortSignal) => requestForm<T>(path, formData, signal),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};
