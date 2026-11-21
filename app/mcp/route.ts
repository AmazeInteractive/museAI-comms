/**
 * museAI-comms hub MCP endpoint — POST /mcp (Streamable HTTP).
 * Stateless (2026-07-28 style): sessionIdGenerator undefined, no
 * Mcp-Session-Id. Uses the SDK WebStandard transport so it works in a
 * Next.js App Router route handler. A fresh McpServer is created per
 * request; the SDK Client's initialize handshake (2025-11-25) is also
 * honoured by the SDK itself, so both spec revisions can talk to it.
 * GET returns hub protocol info as plain JSON (discovery aid).
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createHubServer } from "@/lib/mcp-hub";
import { protocolInfo } from "@/lib/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ...protocolInfo(), endpoint: "/mcp", tools: ["comms_list_servers", "comms_validate_server", "comms_call_tool", "comms_protocol_info"] });
}

export async function POST(req: Request) {
  const server = createHubServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export async function DELETE(req: Request) {
  const server = createHubServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
