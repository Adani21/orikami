// Thin fetch-based replacement for Playwright's APIRequestContext, kept API-compatible
// (.ok()/.status()/.json()/.text() as methods, {data} options object) so the migration
// away from @playwright/test didn't require touching every call site in the specs.
import { recordApiCall } from './callLog';

const BASE_URL = process.env.KRANE_BASE_URL ?? '';
const API_TOKEN = process.env.KRANE_API_TOKEN;

export interface ApiResponse {
  ok(): boolean;
  status(): number;
  json(): Promise<any>;
  text(): Promise<string>;
}

function wrap(res: Response): ApiResponse {
  // A fetch Response body can only be read once, but Playwright's APIResponse (which
  // this shim replaces) let callers call .text()/.json() as many times as they liked
  // (e.g. once in an expect() failure message, again to parse the body). Cache the raw
  // text on first read so every subsequent .text()/.json() call reuses it instead of
  // touching the already-consumed stream.
  let bodyText: Promise<string> | null = null;
  const readText = () => (bodyText ??= res.text());

  return {
    ok: () => res.ok,
    status: () => res.status,
    json: async () => JSON.parse(await readText()),
    text: () => readText(),
  };
}

// auth: omit/true → the real KRANE_API_TOKEN; false → no Authorization header at all;
// a string → send that literal value as the bearer token instead (e.g. a garbage/expired
// token, to distinguish "no credentials" from "bad credentials" in negative tests).
type Auth = boolean | string;

function authHeader(auth: Auth = true): Record<string, string> {
  if (auth === false) return {};
  const token = typeof auth === 'string' ? auth : API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function send(method: string, path: string, data?: unknown, auth?: Auth): Promise<ApiResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeader(auth),
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  recordApiCall({ method, path, status: res.status });
  return wrap(res);
}

export const api = {
  get: (path: string, opts?: { auth?: Auth }) => send('GET', path, undefined, opts?.auth),
  post: (path: string, opts?: { data?: unknown; auth?: Auth }) => send('POST', path, opts?.data, opts?.auth),
  patch: (path: string, opts?: { data?: unknown; auth?: Auth }) => send('PATCH', path, opts?.data, opts?.auth),
  put: (path: string, opts?: { data?: unknown; auth?: Auth }) => send('PUT', path, opts?.data, opts?.auth),
  delete: (path: string, opts?: { auth?: Auth }) => send('DELETE', path, undefined, opts?.auth),
};
