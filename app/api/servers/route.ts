import { NextRequest, NextResponse } from "next/server";
import { addServer, deleteServer, listServers, updateServer } from "@/lib/servers";

const ENV_VAR_RE = /^[A-Z][A-Z0-9_]*$/;

export async function GET() {
  return NextResponse.json({ servers: await listServers() });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const transport = body.transport === "sse" ? "sse" : "streamable-http";
  const authEnvVar = typeof body.authEnvVar === "string" ? body.authEnvVar.trim() : "";
  const authHeaderName = typeof body.authHeaderName === "string" ? body.authHeaderName.trim() : undefined;
  if (!name) return NextResponse.json({ error: "name is required." }, { status: 400 });
  if (!url) return NextResponse.json({ error: "url is required." }, { status: 400 });
  try { const u = new URL(url); if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad"); } catch { return NextResponse.json({ error: "url must be a valid http(s) URL." }, { status: 400 }); }
  if (authEnvVar && !ENV_VAR_RE.test(authEnvVar)) return NextResponse.json({ error: "authEnvVar must be an UPPER_SNAKE_CASE env-var NAME only — never a key value." }, { status: 400 });
  const server = await addServer({ name, url, transport, authEnvVar, authHeaderName });
  return NextResponse.json({ server }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required." }, { status: 400 });
  const ok = await deleteServer(id);
  return NextResponse.json({ deleted: ok });
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const updated = await updateServer(id, body as Parameters<typeof updateServer>[1]);
  if (!updated) return NextResponse.json({ error: "Server not found." }, { status: 404 });
  return NextResponse.json({ server: updated });
}
