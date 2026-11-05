const BASE = "/api/v1";

/** Fehler einer API-Antwort. `status` erlaubt es, einzelne Antworten eigens zu behandeln. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

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
    throw new ApiError(`Serverfehler (HTTP ${res.status}). ${hint}`, res.status);
  }

  if (!res.ok) throw new ApiError(json.detail ?? json.error ?? `Fehler (HTTP ${res.status})`, res.status);
  if (json.error) throw new ApiError(json.error, res.status);
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
  post: <T>(path: string, body: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body), signal }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  postForm: <T>(path: string, formData: FormData, signal?: AbortSignal) => requestForm<T>(path, formData, signal),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};
