# Memory — museAI-comms

## Purpose

Universal MCP Connector Hub: connect any MCP server by URL so other AIs can use it, validate it, and generate client configs for every popular AI. The hub is itself an MCP server at `/mcp`.

## Decisions

- Next.js 14 + TypeScript, App Router, no auth, no payments — same stack as MCP Forge, whose patterns were reused (`data/*.jsonl`, `/api` routes, Railway `$PORT` fix).
- Dual-spec support is a core requirement, not a fallback afterthought: 2026-07-28 stateless first, 2025-11-25 initialize second. Spec facts verified Nov 21, 2026 and cited in `lib/protocol.ts` and `README.md`.
- Auth is env-var NAME only, everywhere (form, registry, client configs, probe options). No key value is ever accepted, stored, or logged.
- No personal names in docs or UI; attribution is to team/business roles only.
- Local-only build: no GitHub push, no Railway deploy in this pass. Target repo is `https://github.com/AmazeInteractive/museAI-comms.git` (public, description "mcp created for connecting and creating products in conjuction with other ai", currently empty).

## Key files

- `lib/protocol.ts` — probe, negotiation, remote tool calls, 60s cache, protocol info.
- `lib/validate.ts` — 0–100 scoring engine.
- `lib/clients.ts` — 8 popular-AI client configs.
- `lib/servers.ts` — `data/servers.jsonl` registry.
- `lib/mcp-hub.ts` — the 4 meta-tools.
- `app/mcp/route.ts` — Streamable HTTP endpoint (SDK WebStandard transport, stateless).
- `app/api/connect/route.ts`, `app/api/validate/route.ts`, `app/api/servers/route.ts`, `app/api/clients/route.ts`.
- `components/Hub.tsx` — home page UI (servers / validate / clients tabs).
