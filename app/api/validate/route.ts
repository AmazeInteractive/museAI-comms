import { NextRequest, NextResponse } from "next/server";
import { validateServer } from "@/lib/validate";
import { probeServer } from "@/lib/protocol";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  // Either probe a live URL, or validate supplied definitions directly.
  if (typeof body.url === "string" && body.url.trim()) {
    const probe = await probeServer(body.url.trim());
    if (!probe.reachable) {
      return NextResponse.json({ score: 0, summary: { pass: 0, warn: 0, fail: 1 }, checks: [{ id: "server-reachable", name: "Server is reachable", severity: "fail", detail: probe.error ?? "Unreachable." }], recommendations: ["Check the URL and transport, then re-test."], probe });
    }
    return NextResponse.json({ ...validateServer({ serverUrl: body.url.trim(), tools: probe.tools, resources: probe.resources, prompts: probe.prompts, transport: probe.transport }), probe });
  }
  const report = validateServer({
    serverName: typeof body.serverName === "string" ? body.serverName : undefined,
    serverUrl: typeof body.serverUrl === "string" ? body.serverUrl : undefined,
    transport: typeof body.transport === "string" ? body.transport : undefined,
    authEnvVar: typeof body.authEnvVar === "string" ? body.authEnvVar : undefined,
    tools: Array.isArray(body.tools) ? (body.tools as never) : [],
    resources: Array.isArray(body.resources) ? (body.resources as never) : [],
    prompts: Array.isArray(body.prompts) ? (body.prompts as never) : [],
    clientConfig: typeof body.clientConfig === "string" ? body.clientConfig : undefined,
  });
  return NextResponse.json(report);
}
