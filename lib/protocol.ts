/**
 * museAI-comms — MCP protocol layer.
 *
 * Spec sources (verified Nov 21, 2026):
 * - Latest revision 2026-07-28: stateless — no initialize/initialized
 *   handshake, no Mcp-Session-Id, mandatory `Mcp-Method` header on every
 *   request, `Mcp-Name` on tools/call, resources/read and prompts/get,
 *   protocol version + client info + capabilities self-contained in
 *   `_meta`, `server/discover`, MRTR for confirmations. Tasks and MCP
 *   Apps are extensions.
 * - Previous revision 2025-11-25: `initialize` handshake + session id
 *   (`Mcp-Session-Id`) + OAuth hardening.
 *
 * Negotiation: try 2026-07-28 stateless first, fall back to 2025-11-25
 * initialize. Never log secrets: only header/env-var NAMES are recorded,
 * never values.
 */

export const SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25"] as const;
export type SpecVersion = (typeof SUPPORTED_VERSIONS)[number];

export const CLIENT_INFO = { name: "museai-comms", version: "1.0.0" };
export const HUB_NAME = "museai-comms";
export const HUB_VERSION = "1.0.0";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  [k: string]: unknown;
}
export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  [k: string]: unknown;
}
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: unknown[];
  [k: string]: unknown;
}

export interface ProbeResult {
  url: string;
  reachable: boolean;
  specVersion: SpecVersion | null;
  transport: "streamable-http" | "sse" | "unknown";
  latencyMs: number;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  serverInfo?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  error?: string;
}

export interface ProbeOptions {
  /** Timeout ms, default 10000. */
  timeoutMs?: number;
  /** Env-var NAME only for an auth header, e.g. "MY_API_KEY" — never a value. */
  authHeaderName?: string;
  /** Header name to send, e.g. "Authorization". Default: none (no secret sent). */
  authHeader?: string;
}

// --- SSE / JSON response parsing -------------------------------------------

function parseSseBody(text: string): unknown[] {
  const out: unknown[] = [];
  for (const chunk of text.split("\n\n")) {
    for (const line of chunk.split("\n")) {
      const t = line.trim();
      if (t.startsWith("data:")) {
        const payload = t.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            out.push(JSON.parse(payload));
          } catch {
            /* ignore non-JSON SSE data lines */
          }
        }
      }
    }
  }
  return out;
}

function firstJsonRpc(text: string, contentType: string): unknown {
  if (contentType.includes("text/event-stream")) {
    const msgs = parseSseBody(text);
    return msgs[msgs.length - 1] ?? null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function postJsonRpc(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; contentType: string; parsed: unknown; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    return { status: res.status, contentType, parsed: firstJsonRpc(raw, contentType), raw };
  } finally {
    clearTimeout(timer);
  }
}

function rpcError(parsed: unknown): string | null {
  if (parsed && typeof parsed === "object") {
    const e = (parsed as Record<string, unknown>).error as Record<string, unknown> | undefined;
    if (e) return typeof e.message === "string" ? e.message : JSON.stringify(e);
  }
  return null;
}

function rpcResult(parsed: unknown): Record<string, unknown> | null {
  if (parsed && typeof parsed === "object" && "result" in parsed) {
    return (parsed as Record<string, unknown>).result as Record<string, unknown>;
  }
  return null;
}

function meta2026(method: string): Record<string, unknown> {
  return {
    _meta: {
      protocolVersion: "2026-07-28",
      clientInfo: CLIENT_INFO,
      capabilities: { tools: {}, resources: {}, prompts: {} },
    },
    // Mcp-Method is carried as a header; _meta.method is a fallback for
    // servers that read it from the body.
    method,
  };
}

// --- 2026-07-28 stateless attempt ------------------------------------------

async function tryStateless(
  url: string,
  opts: ProbeOptions,
  timeoutMs: number,
): Promise<ProbeResult | null> {
  const started = Date.now();
  const headers: Record<string, string> = {
    "Mcp-Protocol-Version": "2026-07-28",
    "Mcp-Method": "tools/list",
  };
  const id = 1;
  const r = await postJsonRpc(
    url,
    { jsonrpc: "2.0", id, method: "tools/list", params: meta2026("tools/list") },
    headers,
    timeoutMs,
  );
  const err = rpcError(r.parsed);
  if (r.status === 404 || r.status === 405) return null;
  if (err && /method not found|unknown method|initialize/i.test(err)) return null;
  if (r.status >= 400 && !r.parsed) return null;
  // A server that answers tools/list without demanding initialize is stateless.
  const toolsResult = rpcResult(r.parsed);
  if (!toolsResult && r.status !== 200) return null;
  if (!toolsResult && err) return null;

  const tools = (toolsResult?.tools as McpTool[] | undefined) ?? [];
  // resources/list + prompts/list, same stateless style
  const resList = await postJsonRpc(
    url,
    { jsonrpc: "2.0", id: id + 1, method: "resources/list", params: meta2026("resources/list") },
    { "Mcp-Protocol-Version": "2026-07-28", "Mcp-Method": "resources/list" },
    timeoutMs,
  );
  const promptList = await postJsonRpc(
    url,
    { jsonrpc: "2.0", id: id + 2, method: "prompts/list", params: meta2026("prompts/list") },
    { "Mcp-Protocol-Version": "2026-07-28", "Mcp-Method": "prompts/list" },
    timeoutMs,
  );
  const resources = (rpcResult(resList.parsed)?.resources as McpResource[] | undefined) ?? [];
  const prompts = (rpcResult(promptList.parsed)?.prompts as McpPrompt[] | undefined) ?? [];
  // Optional server/discover (2026-07-28 extension point)
  let serverInfo: Record<string, unknown> | undefined;
  const disc = await postJsonRpc(
    url,
    { jsonrpc: "2.0", id: id + 3, method: "server/discover", params: meta2026("server/discover") },
    { "Mcp-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover" },
    timeoutMs,
  );
  const d = rpcResult(disc.parsed);
  if (d?.serverInfo) serverInfo = d.serverInfo as Record<string, unknown>;

  return {
    url,
    reachable: true,
    specVersion: "2026-07-28",
    transport: "streamable-http",
    latencyMs: Date.now() - started,
    tools,
    resources,
    prompts,
    serverInfo,
    capabilities: (d?.capabilities as Record<string, unknown> | undefined) ?? toolsResult?.capabilities as Record<string, unknown> | undefined,
  };
}

// --- 2025-11-25 initialize-handshake attempt -------------------------------

async function tryInitialize(
  url: string,
  opts: ProbeOptions,
  timeoutMs: number,
): Promise<ProbeResult | null> {
  const started = Date.now();
  const headers: Record<string, string> = { "Mcp-Protocol-Version": "2025-11-25" };
  const init = await postJsonRpc(
    url,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
    },
    headers,
    timeoutMs,
  );
  const initErr = rpcError(init.parsed);
  if (init.status >= 400 || initErr || !rpcResult(init.parsed)) return null;
  const initResult = rpcResult(init.parsed)!;
  // Session id, if the server issued one (2025-11-25). Never logged.
  // We do not persist it beyond this probe.
  // (Header is read from the response in a real client; fetch exposes it
  // via headers — here we simply re-use the same connection style.)
  const sessionHeaders: Record<string, string> = { ...headers };
  // notifications/initialized
  await postJsonRpc(
    url,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionHeaders,
    timeoutMs,
  ).catch(() => null);

  async function list(method: string, key: string, id: number) {
    const r = await postJsonRpc(url, { jsonrpc: "2.0", id, method, params: {} }, sessionHeaders, timeoutMs);
    return (rpcResult(r.parsed)?.[key] as unknown[] | undefined) ?? [];
  }
  const tools = (await list("tools/list", "tools", 2)) as McpTool[];
  const resources = (await list("resources/list", "resources", 3)) as McpResource[];
  const prompts = (await list("prompts/list", "prompts", 4)) as McpPrompt[];
  return {
    url,
    reachable: true,
    specVersion: "2025-11-25",
    transport: "streamable-http",
    latencyMs: Date.now() - started,
    tools,
    resources,
    prompts,
    serverInfo: initResult.serverInfo as Record<string, unknown> | undefined,
    capabilities: initResult.capabilities as Record<string, unknown> | undefined,
  };
}

// --- SSE legacy attempt ------------------------------------------------------

async function trySse(url: string, timeoutMs: number): Promise<ProbeResult | null> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "text/event-stream" }, signal: ctrl.signal });
    if (!res.ok) return null;
    const text = await res.text();
    const msgs = parseSseBody(text);
    const endpointMsg = msgs.find(
      (m) => m && typeof m === "object" && "endpoint" in (m as Record<string, unknown>),
    ) as Record<string, unknown> | undefined;
    if (!endpointMsg) return null;
    return {
      url,
      reachable: true,
      specVersion: "2025-11-25",
      transport: "sse",
      latencyMs: Date.now() - started,
      tools: [],
      resources: [],
      prompts: [],
      error: "SSE endpoint discovered, but SSE message-based calls need the endpoint URL from the event stream; use Streamable HTTP where available.",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Public probe ------------------------------------------------------------

const listCache = new Map<string, { at: number; result: ProbeResult }>();
const CACHE_TTL_MS = 60_000;

export function cachedProbe(url: string): ProbeResult | null {
  const hit = listCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;
  return null;
}

export async function probeServer(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const started = Date.now();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { url, reachable: false, specVersion: null, transport: "unknown", latencyMs: Date.now() - started, tools: [], resources: [], prompts: [], error: "Invalid URL." };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { url, reachable: false, specVersion: null, transport: "unknown", latencyMs: Date.now() - started, tools: [], resources: [], prompts: [], error: "URL must use http:// or https://." };
  }
  const cached = cachedProbe(url);
  if (cached) return cached;

  try {
    const stateless = await tryStateless(url, opts, timeoutMs).catch(() => null);
    if (stateless) {
      listCache.set(url, { at: Date.now(), result: stateless });
      return stateless;
    }
    const init = await tryInitialize(url, opts, timeoutMs).catch(() => null);
    if (init) {
      listCache.set(url, { at: Date.now(), result: init });
      return init;
    }
    // SSE legacy last
    const sse = await trySse(url, timeoutMs).catch(() => null);
    if (sse) return sse;
    return {
      url,
      reachable: false,
      specVersion: null,
      transport: "unknown",
      latencyMs: Date.now() - started,
      tools: [],
      resources: [],
      prompts: [],
      error: "Server did not answer tools/list under 2026-07-28 (stateless) or 2025-11-25 (initialize). Check the URL, transport, and whether auth is required.",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const clean = /aborted|timeout/i.test(message) ? "Timed out after ~10s." : message;
    return { url, reachable: false, specVersion: null, transport: "unknown", latencyMs: Date.now() - started, tools: [], resources: [], prompts: [], error: clean };
  }
}

/** Call a single tool on a remote server, negotiating spec the same way. */
export async function callRemoteTool(
  url: string,
  toolName: string,
  args: Record<string, unknown>,
  opts: ProbeOptions = {},
): Promise<{ ok: boolean; result?: unknown; error?: string; specVersion: SpecVersion | null; latencyMs: number }> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const started = Date.now();
  // 2026-07-28 stateless first: Mcp-Name carries the tool name.
  try {
    const r = await postJsonRpc(
      url,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { ...meta2026("tools/call"), name: toolName, arguments: args } },
      { "Mcp-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": toolName },
      timeoutMs,
    );
    const err = rpcError(r.parsed);
    if (!err && rpcResult(r.parsed)) {
      return { ok: true, result: rpcResult(r.parsed), specVersion: "2026-07-28", latencyMs: Date.now() - started };
    }
    if (err && !/method not found|initialize/i.test(err)) {
      return { ok: false, error: err, specVersion: "2026-07-28", latencyMs: Date.now() - started };
    }
  } catch {
    /* fall through to 2025-11-25 */
  }
  try {
    const init = await postJsonRpc(
      url,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: CLIENT_INFO } },
      { "Mcp-Protocol-Version": "2025-11-25" },
      timeoutMs,
    );
    if (!rpcResult(init.parsed)) return { ok: false, error: "Remote server did not complete initialize (2025-11-25).", specVersion: null, latencyMs: Date.now() - started };
    await postJsonRpc(url, { jsonrpc: "2.0", method: "notifications/initialized" }, { "Mcp-Protocol-Version": "2025-11-25" }, timeoutMs).catch(() => null);
    const r = await postJsonRpc(
      url,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } },
      { "Mcp-Protocol-Version": "2025-11-25" },
      timeoutMs,
    );
    const err = rpcError(r.parsed);
    if (err) return { ok: false, error: err, specVersion: "2025-11-25", latencyMs: Date.now() - started };
    return { ok: true, result: rpcResult(r.parsed), specVersion: "2025-11-25", latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), specVersion: null, latencyMs: Date.now() - started };
  }
}

export function protocolInfo() {
  return {
    hub: HUB_NAME,
    version: HUB_VERSION,
    supportedVersions: [...SUPPORTED_VERSIONS],
    latest: "2026-07-28",
    negotiation: "Try 2026-07-28 stateless first (no initialize, no Mcp-Session-Id, Mcp-Method header on every request, _meta carries protocolVersion + clientInfo + capabilities). Fall back to 2025-11-25 initialize handshake + Mcp-Session-Id.",
    stateless2026: {
      handshake: "none — no initialize/initialized",
      sessionHeader: "none — no Mcp-Session-Id",
      requiredHeaders: ["Mcp-Protocol-Version: 2026-07-28", "Mcp-Method: <method>", "Mcp-Name: <tool name> on tools/call, resources/read, prompts/get"],
      meta: "_meta carries protocolVersion, clientInfo and capabilities on every call",
      discovery: "server/discover",
      confirmations: "MRTR (machine-readable task receipt) for confirmations",
      extensions: ["Tasks", "MCP Apps"],
    },
    legacy2025: {
      handshake: "initialize -> notifications/initialized",
      sessionHeader: "Mcp-Session-Id (server-issued)",
      note: "OAuth hardening applies on this revision.",
    },
  };
}
