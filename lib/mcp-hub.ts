/**
 * museAI-comms hub MCP server factory.
 * Exposes 4 meta-tools via @modelcontextprotocol/sdk (McpServer):
 * comms_list_servers, comms_validate_server, comms_call_tool,
 * comms_protocol_info. A fresh server is created per request (stateless,
 * 2026-07-28 style); tools/list is cached 60s at the probe layer.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listServers } from "./servers";
import { validateServer } from "./validate";
import { callRemoteTool, probeServer, protocolInfo } from "./protocol";

export function createHubServer(): McpServer {
  const server = new McpServer({ name: "museai-comms", version: "1.0.0" });

  server.registerTool("comms_list_servers", {
    description: "List MCP servers registered in the museAI-comms hub.",
    inputSchema: {},
  }, async () => {
    const servers = await listServers();
    return { content: [{ type: "text" as const, text: JSON.stringify(servers, null, 2) }] };
  });

  server.registerTool("comms_validate_server", {
    description: "Validate an MCP server: probe it by URL if url is given, otherwise validate the supplied tools/resources/prompts. Returns a 0-100 score with pass/warn/fail checks.",
    inputSchema: {
      url: z.string().optional().describe("MCP server URL to probe (Streamable HTTP)."),
      tools: z.array(z.object({}).passthrough()).optional().describe("Tool definitions to validate directly."),
      resources: z.array(z.object({}).passthrough()).optional(),
      prompts: z.array(z.object({}).passthrough()).optional(),
    },
  }, async (args) => {
    let input: Parameters<typeof validateServer>[0] = {
      tools: (args.tools as never) ?? [],
      resources: (args.resources as never) ?? [],
      prompts: (args.prompts as never) ?? [],
    };
    if (args.url) {
      const probe = await probeServer(args.url as string);
      input = { serverUrl: args.url as string, tools: probe.tools, resources: probe.resources, prompts: probe.prompts, transport: probe.transport };
      if (!probe.reachable) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ score: 0, error: probe.error, probe }, null, 2) }] };
      }
    }
    const report = validateServer(input);
    return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
  });

  server.registerTool("comms_call_tool", {
    description: "Proxy a tools/call to a registered server (by serverId or serverUrl). Negotiates 2026-07-28 stateless first, falls back to 2025-11-25 initialize.",
    inputSchema: {
      serverId: z.string().optional().describe("Registered server id."),
      serverUrl: z.string().optional().describe("MCP server URL (if serverId is not given)."),
      tool: z.string().describe("Tool name to call."),
      arguments: z.object({}).passthrough().optional().describe("Tool arguments."),
    },
  }, async (args) => {
    let url = args.serverUrl as string | undefined;
    if (!url && args.serverId) {
      const servers = await listServers();
      url = servers.find((s) => s.id === args.serverId)?.url;
    }
    if (!url) return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "Provide serverId of a registered server or serverUrl." }) }] };
    const result = await callRemoteTool(url, args.tool as string, (args.arguments as Record<string, unknown>) ?? {});
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool("comms_protocol_info", {
    description: "Return the MCP spec versions this hub supports (2025-11-25 and 2026-07-28) and the negotiation logic.",
    inputSchema: {},
  }, async () => ({
    content: [{ type: "text" as const, text: JSON.stringify(protocolInfo(), null, 2) }],
  }));

  return server;
}
