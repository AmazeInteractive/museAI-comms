# museAI-comms

**mcp created for connecting and creating products in conjuction with other ai**

Universal MCP Connector Hub: add any MCP server by URL, probe it live, validate it, and generate client configs for every popular AI — plus the hub is itself an MCP server other AIs can connect to.

## What it does

1. **Connect** — Home page: add an MCP server by URL (Streamable HTTP primary, SSE legacy), name, optional auth by env-var NAME only (never a key value). Saved to `data/servers.jsonl`. List, re-test, delete.
2. **Probe** — `POST /api/connect {url, authHeaderName?}` detects the spec version live, calls `tools/list`, `resources/list`, `prompts/list` (~10s timeout, no secrets logged) and returns capabilities, counts, latency, spec version, and errors verbatim.
3. **Validate & QA** — `lib/validate.ts` + `POST /api/validate`: score 0–100 with pass/warn/fail per check. Covers tool-name regex, duplicates, descriptions, input/output schemas, required-fields-in-properties, dangerous patterns (shell exec, `rm -rf`), hardcoded secrets, prompt-injection phrasing, MCP Apps UI layout (`_meta.ui` valid URI, no remote scripts), client-config code (parses, no secrets, transport valid), and heuristics (naming consistency, description quality, >50 tools warning, no tools = fail).
4. **Capability extension** — this app IS an MCP server at `POST /mcp` (Streamable HTTP via `@modelcontextprotocol/sdk`, stateless, `WebStandardStreamableHTTPServerTransport`) exposing 4 meta-tools: `comms_list_servers`, `comms_validate_server`, `comms_call_tool` (proxies `tools/call` to a registered server), `comms_protocol_info`. `tools/list` caching is 60s at the probe layer; per-call timeout ~10s.
5. **Client scaffolds** — `lib/clients.ts` + UI tabs + `GET /api/clients`: copyable, valid-JSON configs for Claude Desktop, Claude Code, ChatGPT / OpenAI, Gemini CLI, VS Code / Copilot, Cursor (deep link + JSON), Windsurf, and Grok — for ANY registered server and for this hub itself. Each includes server URL, transport, and env-var-name-only auth placeholder.

## MCP protocol — both revisions understood

Spec sources (verified Nov 21, 2026):

- **Latest revision 2026-07-28 (stateless):** no `initialize`/`initialized` handshake, no `Mcp-Session-Id`, mandatory `Mcp-Method` header on every request, `Mcp-Name` on `tools/call`, `resources/read`, `prompts/get`, protocol version + client info + capabilities self-contained in `_meta`, `server/discover`, MRTR for confirmations. Tasks and MCP Apps are extensions.
- **Previous revision 2025-11-25:** `initialize` handshake + session id (`Mcp-Session-Id`) + OAuth hardening.

Negotiation (see `lib/protocol.ts`): try 2026-07-28 stateless first, fall back to 2025-11-25 initialize. The hub endpoint itself is stateless; the SDK also honours an `initialize` handshake from 2025-11-25 clients.

## Run locally

```bash
npm install
npm run dev     # http://localhost:3100
npm run build && npm start
```

## Stack

Next.js 14 + TypeScript (App Router), no auth, no payments. `@modelcontextprotocol/sdk` 1.x, zod.

## Rules

- No personal names anywhere in docs or UI copy — work is attributed to team/business roles only.
- No secrets in code or logs: auth is referenced by environment-variable NAME only, never a key value.
- Local-only until a deploy decision is made (no GitHub push, no Railway deploy yet).

## Deploy (when approved)

1. Push this tree to `https://github.com/AmazeInteractive/museAI-comms.git` (public repo, description: "mcp created for connecting and creating products in conjuction with other ai").
2. Railway: New Project → Deploy from GitHub repo → pick the repo. No env vars required. Generate a domain. Start command is `next start -p ${PORT:-3100}` — never a hardcoded port.
