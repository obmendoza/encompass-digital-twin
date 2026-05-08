// scripts/e2e-harness/http.ts
// Thin fetch() wrapper for API + Agent calls.

const DEFAULT_ACTOR = { kind: "human" as const, id: "e2e-harness" };
const DEFAULT_AGENT_ACTOR = { kind: "agent" as const, id: "e2e-harness-agent" };

export interface HttpOptions {
  baseUrl: string;
  tenantId?: string;
  timeoutMs?: number;
  /** When true, mark this request as super-admin (cross-tenant ops; tenant CRUD). Default false. */
  superAdmin?: boolean;
  /** Override the user identity header. Defaults to "e2e-harness". */
  userId?: string;
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, public bodyText: string) {
    super(`HTTP ${status} ${url}: ${bodyText.slice(0, 200)}`);
  }
}

async function request<T>(
  opts: HttpOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${opts.baseUrl}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  // Auth: x-user-id is the API's accepted internal-service trust header
  // (jwt-tenant-resolver.ts:35-41). Default identity gives the harness access
  // to the demo tenant; tenantId override forges a different tenant for W8.
  // Skip on agent calls — the agent has its own auth model.
  if (!opts.baseUrl.includes(":8000")) {
    headers["x-user-id"] = opts.userId ?? "e2e-harness";
    if (opts.superAdmin) headers["x-super-admin"] = "true";
    // Default tenant: env DEMO_TENANT_ID (the real Supabase demo tenant UUID).
    // Without this, the API middleware defaults to DEFAULT_TENANT_ID (zeros)
    // which won't match getDemoTenantId() and /world/* will return 403.
    const tenantId = opts.tenantId ?? process.env.DEMO_TENANT_ID;
    if (tenantId) headers["x-tenant-id"] = tenantId;
  } else if (opts.tenantId) {
    headers["x-tenant-id"] = opts.tenantId;
  }
  const init: RequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  };
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const http = {
  get: <T>(opts: HttpOptions, path: string) => request<T>(opts, "GET", path),
  post: <T>(opts: HttpOptions, path: string, body?: unknown) => request<T>(opts, "POST", path, body),
  put: <T>(opts: HttpOptions, path: string, body?: unknown) => request<T>(opts, "PUT", path, body),
  delete: <T>(opts: HttpOptions, path: string) => request<T>(opts, "DELETE", path),
};

export const ACTORS = {
  human: DEFAULT_ACTOR,
  agent: DEFAULT_AGENT_ACTOR,
};

export async function pingHealth(apiUrl: string, agentUrl: string): Promise<{ apiOk: boolean; agentOk: boolean; details: string[] }> {
  const details: string[] = [];
  let apiOk = false;
  let agentOk = false;
  try {
    await request<unknown>({ baseUrl: apiUrl, timeoutMs: 2000 }, "GET", "/system/health");
    apiOk = true;
  } catch (e) {
    details.push(`API unhealthy: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await request<unknown>({ baseUrl: agentUrl, timeoutMs: 2000 }, "GET", "/api/health");
    agentOk = true;
  } catch (e) {
    details.push(`Agent unhealthy: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { apiOk, agentOk, details };
}
