import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RegisteredServer {
  id: string;
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  authEnvVar: string; // env var NAME only, "" = none
  authHeaderName?: string;
  createdAt: string;
  lastTest?: { ok: boolean; specVersion: string | null; tools: number; latencyMs: number; error?: string; at: string };
}

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "servers.jsonl");

export async function listServers(): Promise<RegisteredServer[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as RegisteredServer).reverse();
  } catch {
    return [];
  }
}

export async function addServer(s: Omit<RegisteredServer, "id" | "createdAt">): Promise<RegisteredServer> {
  const entry: RegisteredServer = { ...s, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() };
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(FILE, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export async function deleteServer(id: string): Promise<boolean> {
  const all = await listServers();
  const kept = all.filter((s) => s.id !== id);
  if (kept.length === all.length) return false;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, kept.reverse().map((s) => JSON.stringify(s)).join("\n") + (kept.length ? "\n" : ""), "utf8");
  return true;
}

export async function updateServer(id: string, patch: Partial<RegisteredServer>): Promise<RegisteredServer | null> {
  const all = await listServers();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, [...all].reverse().map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  return all[idx];
}
