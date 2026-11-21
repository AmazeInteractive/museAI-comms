# Progress — museAI-comms

## Nov 21, 2026 — initial build (local only)

- Scaffolded Next.js 14 + TypeScript app in `~/workspace/museai-comms/`, reusing MCP Forge patterns (`data/*.jsonl` registry, `/api` routes, Railway `$PORT` start script `next start -p ${PORT:-3100}`).
- Protocol layer (`lib/protocol.ts`): dual-spec negotiation — 2026-07-28 stateless first, 2025-11-25 initialize fallback; SSE legacy discovery; 60s `tools/list` cache; ~10s timeouts; no secrets logged.
- Validation engine (`lib/validate.ts` + `POST /api/validate`): 0–100 score, per-check pass/warn/fail covering names, duplicates, descriptions, schemas, dangerous patterns, hardcoded secrets, prompt injection, MCP Apps UI layout, client-config code, transport, and heuristics.
- Hub MCP server (`lib/mcp-hub.ts` + `POST /mcp` via SDK `WebStandardStreamableHTTPServerTransport`, stateless): 4 meta-tools — `comms_list_servers`, `comms_validate_server`, `comms_call_tool`, `comms_protocol_info`.
- Client scaffolds (`lib/clients.ts` + `GET /api/clients` + UI tabs): Claude Desktop, Claude Code, ChatGPT / OpenAI, Gemini CLI, VS Code / Copilot, Cursor, Windsurf, Grok — for any registered server and for the hub itself.
- Home page: add server by URL, list / re-test / delete, Validate & QA tab with good/bad samples, client-scaffold tabs.
- Verified locally (see verification section in the final report / run log): build, homepage, validate good vs bad, connect unreachable, `/mcp` tools/list.

## Still to do (needs approval)

- Push to `https://github.com/AmazeInteractive/museAI-comms.git` (public, currently empty).
- Railway project → service from GitHub → public domain.
- Live probe test against a real public MCP server once deployed.
