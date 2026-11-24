// The deal rooms, offered to an outside agent as MCP tools over HTTP (JSON-RPC 2.0).
//
// This is how a deal room is worked from inside another messenger: Teamily's agent is pointed at
// this endpoint, and can then read the rooms, read one in full, say something in it and tick a
// task off, without anybody leaving that chat.
//
// Two rules hold here, whoever is calling:
//   1. Approving a draft is not a tool. Reading what was written is fine; deciding to send it is a
//      rep's press in this app's own screen, and nothing reachable from outside can do it.
//   2. Inviting the client into a room is not a tool either, for the same reason.
// What is left - reading, saying something, ticking a task off - is internal and undoable.
//
// Off unless CONNET_MCP_TOKEN is set, because a public URL (ngrok) puts this on the open web.
import { completeTask, getDealRoom, listDealRooms, postToDealRoom } from "@/lib/dealroom";
import { config } from "@/lib/config";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

const PROTOCOL = "2025-06-18";

type Params = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

const TOOLS = [
  {
    name: "list_deal_rooms",
    description: "List the deal rooms that are open, newest first: the company, its tier and score, the stage it is at, and how many tasks nobody has done yet.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_deal_room",
    description: "Read one deal room in full: who is in it, the brief the agent wrote, everything said since, and who owns which task. Takes the leadId from list_deal_rooms.",
    inputSchema: {
      type: "object",
      properties: { leadId: { type: "string", description: "The lead id, as list_deal_rooms gives it" } },
      required: ["leadId"],
      additionalProperties: false,
    },
  },
  {
    name: "post_to_deal_room",
    description: "Say something in a deal room. It is marked as coming from outside this app, and it is internal: the client is not in the room.",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "The lead id, as list_deal_rooms gives it" },
        text: { type: "string", description: "What to say, in plain words" },
      },
      required: ["leadId", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_task",
    description: "Tick a task off in a deal room, or put it back. Task ids come from get_deal_room.",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        taskId: { type: "string" },
        done: { type: "boolean", description: "Leave it out to tick it off" },
      },
      required: ["leadId", "taskId"],
      additionalProperties: false,
    },
  },
];

function callTool(name: string, args: Params): string {
  switch (name) {
    case "list_deal_rooms": {
      const rooms = listDealRooms();
      if (rooms.length === 0) return "No deal rooms yet. One opens when a rep approves the first email to a company.";
      return JSON.stringify(rooms, null, 2);
    }
    case "get_deal_room": {
      const room = getDealRoom(str(args.leadId));
      if (!room) return `There is no deal room for ${str(args.leadId)}. Call list_deal_rooms for the ones there are.`;
      return JSON.stringify(room, null, 2);
    }
    case "post_to_deal_room": {
      const text = str(args.text).trim().slice(0, 2000);
      if (text.length < 2) return "Say something first.";
      const room = postToDealRoom(str(args.leadId), text, "note", true, "outside");
      if (!room) return `There is no deal room for ${str(args.leadId)}.`;
      store().audit("agent", "Posted to a deal room from outside", { leadId: str(args.leadId), note: text.slice(0, 160) });
      return "Said in the room.";
    }
    case "complete_task": {
      const done = args.done === undefined ? true : args.done === true;
      completeTask(str(args.leadId), str(args.taskId), done);
      return done ? "Ticked off." : "Put back.";
    }
    default:
      throw new Error(`No such tool: ${name}`);
  }
}

const result = (id: unknown, value: unknown) => Response.json({ jsonrpc: "2.0", id, result: value });
const failed = (id: unknown, code: number, message: string) => Response.json({ jsonrpc: "2.0", id, error: { code, message } });

export async function POST(request: Request) {
  // A public URL puts this on the open web, so it stays shut until there is a token to check.
  if (!config.mcpToken) return Response.json({ error: "This endpoint is off. Set CONNET_MCP_TOKEN in .env.local to turn it on." }, { status: 404 });
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || request.headers.get("x-api-key") || "";
  if (given !== config.mcpToken) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { id?: unknown; method?: string; params?: Params } | null;
  if (!body || typeof body.method !== "string") return failed(null, -32700, "Could not read that as JSON-RPC");
  const { id = null, method, params = {} } = body;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `${config.appName} deal rooms`, version: "1.0.0" },
        instructions: "The deal rooms this app opens when a rep approves an email. Read them, say something in one, tick a task off. Approving a draft and inviting the client are not offered here: those stay presses in the app's own screen.",
      });
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: TOOLS });
    case "tools/call": {
      const name = str((params as Params).name);
      const args = ((params as Params).arguments || {}) as Params;
      try {
        return result(id, { content: [{ type: "text", text: callTool(name, args) }] });
      } catch (e) {
        // A tool that refuses says why, in the answer, so the agent can tell the person.
        return result(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      // Notifications carry no id and want no answer.
      if (method.startsWith("notifications/")) return new Response(null, { status: 202 });
      return failed(id, -32601, `No such method: ${method}`);
  }
}

/** A GET says what this is, so opening the URL in a browser is not a puzzle. */
export async function GET() {
  if (!config.mcpToken) return Response.json({ error: "This endpoint is off. Set CONNET_MCP_TOKEN in .env.local to turn it on." }, { status: 404 });
  return Response.json({
    name: `${config.appName} deal rooms`,
    transport: "MCP over HTTP, JSON-RPC 2.0. POST here with an Authorization: Bearer <CONNET_MCP_TOKEN> header.",
    tools: TOOLS.map((t) => t.name),
  });
}
