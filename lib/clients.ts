/**
 * museAI-comms — client scaffolds.
 * Generates copyable, valid-JSON configs for every popular AI for ANY
 * registered server AND for this hub itself. Auth is referenced by
 * env-var NAME only (placeholder ${NAME} / <NAME>), never a key value.
 */

export interface ScaffoldServer {
  name: string;
  url: string;
  transport?: string;
  authEnvVar?: string; // env var NAME only
}

export interface ClientConfig {
  id: string;
  label: string;
  file: string;
  format: "json" | "url" | "text";
  config: string;
  instructions: string;
  deepLink?: string;
}

function authHeaders(s: ScaffoldServer): Record<string, string> | undefined {
  if (!s.authEnvVar) return undefined;
  // Placeholder referencing the env-var name — the user sets the value
  // in their own environment; no value is ever stored here.
  return { Authorization: `Bearer \${${s.authEnvVar}}` };
}

function json(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

function serverEntry(s: ScaffoldServer, style: "http" | "stdio"): Record<string, unknown> {
  const headers = authHeaders(s);
  if (style === "http") {
    return { url: s.url, type: "http", transport: "streamable-http", ...(headers ? { headers } : {}) };
  }
  return { command: "node", args: [s.url], ...(headers ? { env: { [s.authEnvVar!]: `<your-${s.authEnvVar!.toLowerCase()}-here>` } } : {}) };
}

export const CLIENT_IDS = [
  "claude-desktop",
  "claude-code",
  "chatgpt",
  "gemini-cli",
  "vscode-copilot",
  "cursor",
  "windsurf",
  "grok",
] as const;

export function buildClientConfigs(s: ScaffoldServer): ClientConfig[] {
  const name = s.name.trim() || "mcp-server";
  const mcpServers = { [name]: serverEntry(s, "http") };
  const cursorConfig = encodeURIComponent(json({ mcpServers }));
  const deepLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${cursorConfig}`;
  return [
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      file: "claude_desktop_config.json → mcpServers",
      format: "json",
      config: json({ mcpServers }),
      instructions: "Paste under mcpServers in Claude Desktop settings, then restart Claude Desktop. If auth is set, export the env var named in the placeholder first.",
    },
    {
      id: "claude-code",
      label: "Claude Code",
      file: ".mcp.json (project root)",
      format: "json",
      config: json({ mcpServers }),
      instructions: "Save as .mcp.json in the project root. Claude Code picks it up on next launch; scope it per-project, not globally, for untrusted servers.",
    },
    {
      id: "chatgpt",
      label: "ChatGPT / OpenAI (developer mode)",
      file: "ChatGPT → Settings → Connectors → MCP server URL",
      format: "json",
      config: json({ type: "mcp", server_label: name, server_url: s.url, transport: "streamable-http", require_approval: "never", ...(authHeaders(s) ? { headers: authHeaders(s) } : {}) }),
      instructions: "In ChatGPT developer mode, add an MCP connector with this server URL. Paste the URL, not the JSON, into the connector field.",
    },
    {
      id: "gemini-cli",
      label: "Gemini CLI",
      file: "~/.gemini/settings.json → mcpServers",
      format: "json",
      config: json({ mcpServers }),
      instructions: "Add under mcpServers in ~/.gemini/settings.json, then restart Gemini CLI.",
    },
    {
      id: "vscode-copilot",
      label: "VS Code / Copilot",
      file: ".vscode/mcp.json",
      format: "json",
      config: json({ servers: { [name]: { type: "http", url: s.url, ...(authHeaders(s) ? { headers: authHeaders(s) } : {}) } } }),
      instructions: "Save as .vscode/mcp.json in the workspace. VS Code lists the server under Copilot → MCP servers.",
    },
    {
      id: "cursor",
      label: "Cursor",
      file: "Cursor → Settings → MCP",
      format: "url",
      config: deepLink,
      deepLink,
      instructions: "Open the deep link to install in Cursor, or paste the JSON below into Cursor → Settings → MCP → Add new global MCP server.",
    },
    {
      id: "windsurf",
      label: "Windsurf",
      file: "Windsurf → Settings → MCP",
      format: "json",
      config: json({ mcpServers }),
      instructions: "Add under mcpServers in Windsurf MCP settings and restart Windsurf.",
    },
    {
      id: "grok",
      label: "Grok",
      file: "Grok → MCP server URL",
      format: "json",
      config: json({ type: "mcp", server_label: name, server_url: s.url, transport: "streamable-http", ...(authHeaders(s) ? { headers: authHeaders(s) } : {}) }),
      instructions: "Add this server URL as an MCP server in Grok. Paste the URL into the MCP field; keep the JSON as a record.",
    },
  ];
}

export function hubScaffold(hubUrl: string): ScaffoldServer {
  return { name: "museai-comms", url: hubUrl.replace(/\/$/, "") + "/mcp", transport: "streamable-http" };
}
