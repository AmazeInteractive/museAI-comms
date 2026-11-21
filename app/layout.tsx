import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "museAI-comms — Universal MCP Connector Hub",
  description:
    "Connect any MCP server by URL, probe it under both MCP spec revisions (2026-07-28 stateless and 2025-11-25 initialize), validate it, and generate client configs for every popular AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <h1>museAI-comms</h1>
          <p>Universal MCP Connector Hub — one URL in, every AI connected.</p>
        </header>
        <main>{children}</main>
        <footer>
          museAI-comms — connects MCP servers across AIs. Spec: 2026-07-28 stateless first,
          2025-11-25 initialize fallback. Auth is referenced by environment-variable name only;
          no key values are stored here.
        </footer>
      </body>
    </html>
  );
}
