/**
 * museAI-comms — validation & QA engine.
 * Scores a server's tools/resources/prompts 0-100 with pass/warn/fail
 * per check. Covers naming, schemas, dangerous patterns, prompt
 * injection, MCP Apps layout, generated client-config code, and
 * naming/description heuristics. Deterministic, no LLM.
 */

import type { McpPrompt, McpResource, McpTool } from "./protocol";

export type Severity = "pass" | "warn" | "fail";
export interface CheckResult {
  id: string;
  name: string;
  severity: Severity;
  detail: string;
  path?: string;
}
export interface ValidationInput {
  serverName?: string;
  serverUrl?: string;
  transport?: string;
  authEnvVar?: string;
  tools?: McpTool[];
  resources?: McpResource[];
  prompts?: McpPrompt[];
  /** Optional generated client-config JSON string to check for parseability/secrets. */
  clientConfig?: string;
}
export interface ValidationReport {
  score: number;
  summary: { pass: number; warn: number; fail: number };
  checks: CheckResult[];
  recommendations: string[];
}

const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const ENV_VAR_RE = /^[A-Z][A-Z0-9_]*$/;
const DANGEROUS_RE = /\b(rm\s+-rf|rm\s+--recursive|mkfs|dd\s+if=|:?\(\)\s*\{|shutdown|reboot|chmod\s+777|sudo\s+rm|exec\(|eval\(|subprocess|os\.system|shell\s*=\s*true)\b/i;
const SECRET_RE = /\b(api[_-]?key|secret|password|passwd|token|bearer|private[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9\-_]{8,}['"]?/i;
const SECRET_VALUE_RE = /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{8,})/;
const INJECTION_RE = /(ignore (all )?(previous|prior|above) instructions|disregard (all )?(previous|prior|above) instructions|you are now|system prompt|reveal (your|the) (system|secret|api)|bypass (all )?(safety|security|filter)|do not (tell|mention|reveal)|jailbreak|DAN mode)/i;
const REMOTE_SCRIPT_RE = /<script[^>]+src\s*=\s*["']https?:\/\//i;
const VAGUE_RE = /^(does|do|get|handle|process|run|stuff|thing|misc|helper|util)/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function validateServer(input: ValidationInput): ValidationReport {
  const checks: CheckResult[] = [];
  const tools = input.tools ?? [];
  const resources = input.resources ?? [];
  const prompts = input.prompts ?? [];
  const add = (id: string, name: string, severity: Severity, detail: string, path?: string) =>
    checks.push({ id, name, severity, detail, path });

  // -- naming ---------------------------------------------------------------
  const badNames = tools.filter((t) => !t.name || !TOOL_NAME_RE.test(t.name));
  add("tool-name-regex", "Tool names match ^[a-zA-Z0-9_-]{1,128}$",
    badNames.length ? "fail" : "pass",
    badNames.length ? `${badNames.length} tool name(s) fail the regex: ${badNames.map((t) => t.name || "(empty)").join(", ")}` : "All tool names are valid.");
  const seen = new Map<string, number>();
  tools.forEach((t) => seen.set(t.name, (seen.get(t.name) ?? 0) + 1));
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([n]) => n);
  add("duplicate-tool-names", "No duplicate tool names",
    dups.length ? "fail" : "pass",
    dups.length ? `Duplicate tool name(s): ${dups.join(", ")}` : "No duplicate tool names.");

  // -- descriptions ---------------------------------------------------------
  const missingDesc = tools.filter((t) => !t.description || !t.description.trim());
  add("tool-description-present", "Every tool has a description",
    missingDesc.length ? "fail" : "pass",
    missingDesc.length ? `${missingDesc.length} tool(s) missing a description: ${missingDesc.map((t) => t.name).join(", ")}` : "Every tool has a description.");
  const shortDesc = tools.filter((t) => t.description && t.description.trim().length < 10);
  add("tool-description-length", "Descriptions are at least 10 characters",
    shortDesc.length ? "warn" : "pass",
    shortDesc.length ? `${shortDesc.length} description(s) under 10 chars: ${shortDesc.map((t) => t.name).join(", ")}` : "All descriptions are at least 10 characters.");
  const vague = tools.filter((t) => t.description && VAGUE_RE.test(t.description.trim()));
  add("description-quality", "Descriptions are specific (not vague verbs)",
    vague.length ? "warn" : "pass",
    vague.length ? `Vague description(s): ${vague.map((t) => t.name).join(", ")}` : "Descriptions look specific.");

  // -- schemas --------------------------------------------------------------
  const badSchema = tools.filter((t) => !isPlainObject(t.inputSchema) || (t.inputSchema as Record<string, unknown>).type !== "object");
  add("input-schema-valid", "inputSchema is a JSON Schema object with type \"object\"",
    badSchema.length ? "fail" : "pass",
    badSchema.length ? `${badSchema.length} tool(s) with missing/invalid inputSchema: ${badSchema.map((t) => t.name).join(", ")}` : "All inputSchemas are valid objects.");
  const badRequired = tools.filter((t) => {
    if (!isPlainObject(t.inputSchema)) return false;
    const s = t.inputSchema as Record<string, unknown>;
    if (!Array.isArray(s.required)) return false;
    const props = isPlainObject(s.properties) ? Object.keys(s.properties) : [];
    return (s.required as unknown[]).some((r) => typeof r === "string" && !props.includes(r));
  });
  add("required-fields-exist", "Every required field exists in properties",
    badRequired.length ? "fail" : "pass",
    badRequired.length ? `required lists a field not in properties: ${badRequired.map((t) => t.name).join(", ")}` : "All required fields exist in properties.");
  const withOutput = tools.filter((t) => t.outputSchema !== undefined);
  const badOutput = withOutput.filter((t) => !isPlainObject(t.outputSchema));
  add("output-schema-valid", "outputSchema, when present, is a valid schema object",
    badOutput.length ? "fail" : "pass",
    badOutput.length ? `${badOutput.length} tool(s) with invalid outputSchema: ${badOutput.map((t) => t.name).join(", ")}` : withOutput.length ? `${withOutput.length} outputSchema(s) valid.` : "No outputSchema present (optional).");

  // -- dangerous / secret / injection ---------------------------------------
  const dangerous = tools.filter((t) => DANGEROUS_RE.test(`${t.name} ${t.description ?? ""} ${JSON.stringify(t.inputSchema ?? {})}`));
  add("dangerous-patterns", "No shell-exec / destructive patterns in tools",
    dangerous.length ? "fail" : "pass",
    dangerous.length ? `Dangerous pattern in: ${dangerous.map((t) => t.name).join(", ")}` : "No dangerous patterns found.");
  const secretTools = tools.filter((t) => {
    const hay = `${t.name} ${t.description ?? ""} ${JSON.stringify(t.inputSchema ?? {})} ${JSON.stringify(t.outputSchema ?? {})}`;
    return SECRET_RE.test(hay) || SECRET_VALUE_RE.test(hay);
  });
  add("hardcoded-secrets", "No hardcoded secrets / API keys / passwords in tools",
    secretTools.length ? "fail" : "pass",
    secretTools.length ? `Possible hardcoded secret in: ${secretTools.map((t) => t.name).join(", ")}` : "No hardcoded secrets found.");
  const injected = tools.filter((t) => INJECTION_RE.test(t.description ?? ""));
  add("prompt-injection-phrasing", "No prompt-injection phrasing in descriptions",
    injected.length ? "fail" : "pass",
    injected.length ? `Injection-style phrasing in: ${injected.map((t) => t.name).join(", ")}` : "No injection phrasing found.");
  if (input.authEnvVar !== undefined && input.authEnvVar !== "") {
    const ok = ENV_VAR_RE.test(input.authEnvVar);
    add("auth-env-var-name-only", "Auth is referenced by env-var NAME only",
      ok ? "pass" : "fail",
      ok ? `Auth env var name "${input.authEnvVar}" is UPPER_SNAKE_CASE; no value stored.` : `"${input.authEnvVar}" is not a valid env-var NAME — never store a key value.`);
  }

  // -- MCP Apps layout -------------------------------------------------------
  const withUi = tools.filter((t) => isPlainObject(t._meta) && (t._meta as Record<string, unknown>).ui !== undefined);
  const badUi = withUi.filter((t) => {
    const ui = (t._meta as Record<string, unknown>).ui as unknown;
    if (typeof ui === "string") {
      try {
        const u = new URL(ui);
        return u.protocol !== "http:" && u.protocol !== "https:" && !ui.startsWith("ui://");
      } catch {
        return true;
      }
    }
    return !isPlainObject(ui);
  });
  const remoteScript = withUi.filter((t) => REMOTE_SCRIPT_RE.test(JSON.stringify(t._meta ?? {})));
  add("mcp-apps-ui", "MCP Apps UI (_meta.ui) is a valid URI, no remote scripts",
    badUi.length || remoteScript.length ? "fail" : "pass",
    withUi.length === 0
      ? "No MCP Apps UI present (optional)."
      : badUi.length || remoteScript.length
        ? `Invalid UI in: ${[...badUi, ...remoteScript].map((t) => t.name).join(", ")}`
        : `${withUi.length} tool(s) with valid MCP Apps UI.`);

  // -- code checks (client config) -------------------------------------------
  if (input.clientConfig !== undefined) {
    let parsed: unknown = null;
    let parseErr = "";
    try {
      parsed = JSON.parse(input.clientConfig);
    } catch (e) {
      parseErr = e instanceof Error ? e.message : String(e);
    }
    add("client-config-parses", "Generated client config JSON parses",
      parseErr ? "fail" : "pass",
      parseErr ? `Client config does not parse: ${parseErr}` : "Client config JSON parses.");
    if (!parseErr) {
      const hay = input.clientConfig;
      const hasSecret = SECRET_VALUE_RE.test(hay) || /"api[_-]?key"\s*:\s*"[^$<][^"]{8,}"/i.test(hay);
      add("client-config-no-secrets", "Client config has no hardcoded secrets",
        hasSecret ? "fail" : "pass",
        hasSecret ? "Client config appears to contain a hardcoded secret value." : "No hardcoded secret in client config.");
    }
  }
  if (input.transport !== undefined) {
    const ok = ["streamable-http", "http", "sse", "stdio"].includes(input.transport);
    add("transport-valid", "Transport field is valid",
      ok ? "pass" : "fail",
      ok ? `Transport "${input.transport}" is valid.` : `Transport "${input.transport}" is not a known transport (streamable-http, http, sse, stdio).`);
  }
  if (input.serverUrl !== undefined) {
    let ok = false;
    try {
      const u = new URL(input.serverUrl);
      ok = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      ok = false;
    }
    add("server-url-valid", "Server URL is a valid http(s) URL",
      ok ? "pass" : "fail",
      ok ? `Server URL "${input.serverUrl}" is valid.` : `Server URL "${input.serverUrl}" is not a valid http(s) URL.`);
  }

  // -- heuristics ------------------------------------------------------------
  add("tool-count", "Tool count is sane (1–50)",
    tools.length === 0 ? "fail" : tools.length > 50 ? "warn" : "pass",
    tools.length === 0 ? "No tools — a server with no tools fails validation." : tools.length > 50 ? `${tools.length} tools — over 50 is a warning: consider splitting the server.` : `${tools.length} tool(s).`);
  const snake = tools.filter((t) => /^[a-z][a-z0-9_]*$/.test(t.name)).length;
  add("naming-consistency", "Naming is consistent (snake_case majority)",
    tools.length === 0 ? "warn" : snake / tools.length >= 0.8 ? "pass" : "warn",
    tools.length === 0 ? "No tools to judge naming." : `${snake}/${tools.length} tool(s) snake_case.`);
  const badRes = resources.filter((r) => !r.uri || !r.uri.trim());
  const dupRes = resources.length - new Set(resources.map((r) => r.uri)).size;
  add("resources-valid", "Resources have URIs and no duplicates",
    badRes.length || dupRes ? "fail" : "pass",
    badRes.length ? `${badRes.length} resource(s) missing a URI.` : dupRes ? `${dupRes} duplicate resource URI(s).` : `${resources.length} resource(s) valid.`);
  const badPrompts = prompts.filter((p) => !p.name || !TOOL_NAME_RE.test(p.name));
  const dupPrompts = prompts.length - new Set(prompts.map((p) => p.name)).size;
  add("prompts-valid", "Prompts have valid, unique names",
    badPrompts.length || dupPrompts ? "fail" : "pass",
    badPrompts.length ? `${badPrompts.length} prompt(s) with invalid names.` : dupPrompts ? `${dupPrompts} duplicate prompt name(s).` : `${prompts.length} prompt(s) valid.`);

  // -- scoring ----------------------------------------------------------------
  let score = 100;
  for (const c of checks) {
    if (c.severity === "fail") score -= c.id === "tool-count" && tools.length === 0 ? 20 : 10;
    if (c.severity === "warn") score -= 4;
  }
  score = Math.max(0, Math.min(100, score));
  const summary = {
    pass: checks.filter((c) => c.severity === "pass").length,
    warn: checks.filter((c) => c.severity === "warn").length,
    fail: checks.filter((c) => c.severity === "fail").length,
  };
  const recommendations: string[] = [];
  for (const c of checks) {
    if (c.severity === "fail") recommendations.push(`Fix: ${c.name} — ${c.detail}`);
    else if (c.severity === "warn") recommendations.push(`Improve: ${c.name} — ${c.detail}`);
  }
  if (score >= 90) recommendations.push("Ready to connect: score 90+ — publish the client configs for this server.");
  else if (score >= 70) recommendations.push("Usable with fixes: address the fails above before sharing this server broadly.");
  else recommendations.push("Not ready: fix all fails before connecting other AIs to this server.");
  return { score, summary, checks, recommendations };
}
