// Puts /api/mcp on a public URL so Teamily's agent can reach the deal rooms, and writes the
// settings to paste into Teamily.   npm run tunnel            (port 3000)
//                                   npm run tunnel -- 3001    (another port)
//
// It uses a Cloudflare quick tunnel, which needs no account and no key. The URL is new every
// time, so re-paste it into Teamily whenever this is restarted. Ctrl-C closes it, and the
// endpoint stops being reachable from outside the moment it does.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const PORT = process.argv[2] || "3000";
const OUT = path.join(process.cwd(), "teamily-mcp.local.json");
const token = (process.env.CONNET_MCP_TOKEN || "").trim();

if (!token) {
  console.error("\n  No CONNET_MCP_TOKEN in .env.local, so /api/mcp is off and there is nothing to put on a public URL.");
  console.error("  Make one up (it is your own password for this endpoint, not a key from anybody):\n");
  console.error("    echo \"CONNET_MCP_TOKEN=$(openssl rand -hex 32)\" >> .env.local\n");
  process.exit(1);
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json()) as { result?: { tools?: unknown[] } };
    return res.ok && Array.isArray(body.result?.tools);
  } catch {
    return false;
  }
}

async function main() {
  // The app has to be up first, or the tunnel points at nothing.
  if (!(await reachable(`http://localhost:${PORT}/api/mcp`))) {
    console.error(`\n  Nothing answering on http://localhost:${PORT}/api/mcp.`);
    console.error(`  Start the app first (npm run dev), check the port, and that .env.local has the same token.\n`);
    process.exit(1);
  }
  console.log(`\n  The deal rooms answer on localhost:${PORT}. Opening a public way in.\n`);

  const child = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", () => {
    console.error("  cloudflared is not installed.  brew install cloudflared\n");
    process.exit(1);
  });

  let found = false;
  const watch = async (chunk: Buffer) => {
    const text = chunk.toString();
    const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (!url || found) return;
    found = true;
    const endpoint = `${url}/api/mcp`;

    // A quick tunnel takes a moment to start carrying traffic.
    let live = false;
    for (let i = 0; i < 10 && !live; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      live = await reachable(endpoint);
    }

    const settings = {
      note: "Paste these into Teamily as an MCP server. This file holds a secret: it is git-ignored, do not commit or share it. The URL changes every time the tunnel restarts.",
      mcpServers: {
        "connet-deal-rooms": {
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    };
    fs.writeFileSync(OUT, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });

    console.log(`  ${live ? "Live" : "Open, but not answering yet - give it a few seconds"}.\n`);
    console.log("  In Teamily, add an MCP server with:\n");
    console.log(`    URL     ${endpoint}`);
    console.log(`    Header  Authorization: Bearer <CONNET_MCP_TOKEN>\n`);
    console.log(`  Both, with the token filled in, are in ${path.basename(OUT)} (git-ignored).`);
    console.log("  Tools: list_deal_rooms, get_deal_room, post_to_deal_room, complete_task.");
    console.log("  Approving a draft and inviting the client are not offered: those stay presses in the app.\n");
    console.log("  Ctrl-C closes the tunnel and takes it off the internet again.\n");
  };

  child.stdout.on("data", watch);
  child.stderr.on("data", watch); // cloudflared prints the URL on stderr
  const close = () => {
    child.kill("SIGINT");
    console.log("\n  Tunnel closed. /api/mcp is back to being reachable only from this machine.\n");
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

void main();
