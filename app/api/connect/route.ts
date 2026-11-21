import { NextRequest, NextResponse } from "next/server";
import { probeServer } from "@/lib/protocol";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "url is required." }, { status: 400 });
  // Only a header NAME may be supplied — never a secret value.
  const authHeaderName = typeof body.authHeaderName === "string" ? body.authHeaderName.trim() : undefined;
  const result = await probeServer(url, { authHeaderName });
  return NextResponse.json(result);
}
