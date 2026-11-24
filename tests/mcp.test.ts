// The deal rooms offered over MCP: what is there, what is refused, and what is not offered at all.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TACT_SAMPLE = "1";
process.env.TACT_DATA_DIR = ".data-test-mcp";
process.env.CONNET_MCP_TOKEN = "test-token";

const rpc = async (route: { POST: (r: Request) => Promise<Response> }, method: string, params: unknown = {}, token = "test-token") =>
  route.POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );

const said = async (res: Response) => {
  const body = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
  return { text: body.result?.content?.[0]?.text || "", isError: body.result?.isError === true };
};

test("the deal rooms over MCP", async (t) => {
  const { GLYPH_FOUNDER, GLYPH_PRODUCT } = await import("../lib/sample/data");
  const p = await import("../lib/pipeline");
  const { store } = await import("../lib/store");
  const route = await import("../app/api/mcp/route");
  const s = store();
  s.reset();
  await p.runPipeline(GLYPH_PRODUCT, GLYPH_FOUNDER);
  const draft = s.state.messages.find((m) => m.status === "draft" && m.toEmail)!;
  p.decideMessage(draft.id, "approve");
  const leadId = draft.leadId;

  await t.test("a caller without the token is turned away", async () => {
    const res = await rpc(route, "tools/list", {}, "wrong");
    assert.equal(res.status, 401);
  });

  await t.test("it says what it is and what it can do", async () => {
    const hello = (await (await rpc(route, "initialize")).json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    assert.equal(hello.result.protocolVersion, "2025-06-18");
    assert.ok(hello.result.serverInfo.name);
    const list = (await (await rpc(route, "tools/list")).json()) as { result: { tools: { name: string; inputSchema: unknown }[] } };
    const names = list.result.tools.map((x) => x.name).sort();
    assert.deepEqual(names, ["complete_task", "get_deal_room", "list_deal_rooms", "post_to_deal_room"]);
    assert.ok(list.result.tools.every((x) => x.inputSchema));
  });

  await t.test("approving and inviting the client are not offered here", async () => {
    const list = (await (await rpc(route, "tools/list")).json()) as { result: { tools: { name: string }[] } };
    const names = list.result.tools.map((x) => x.name);
    for (const forbidden of ["approve", "send", "decide_message", "invite_client", "inviteClient"]) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not be a tool`);
    }
    const tried = await rpc(route, "tools/call", { name: "invite_client", arguments: { leadId } });
    assert.equal((await said(tried)).isError, true);
  });

  await t.test("it lists the rooms and reads one in full", async () => {
    const list = await said(await rpc(route, "tools/call", { name: "list_deal_rooms", arguments: {} }));
    const rooms = JSON.parse(list.text) as { leadId: string; company: string; openTasks: number }[];
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].leadId, leadId);
    assert.ok(rooms[0].openTasks > 0);

    const one = await said(await rpc(route, "tools/call", { name: "get_deal_room", arguments: { leadId } }));
    const room = JSON.parse(one.text) as { messages: { kind: string; text: string }[]; tasks: { id: string; owner: string }[] };
    assert.equal(room.messages[0].kind, "brief");
    assert.ok(room.tasks.length >= 3);
    assert.ok(room.tasks.every((task) => task.owner && !task.owner.startsWith("tm")), "a task says the role, not an id");
  });

  await t.test("it can say something in a room, marked as from outside", async () => {
    const out = await said(await rpc(route, "tools/call", { name: "post_to_deal_room", arguments: { leadId, text: "Finance here: pricing is ready." } }));
    assert.equal(out.isError, false);
    const room = (s.state.dealRooms || []).find((r) => r.leadId === leadId)!;
    const last = room.messages[room.messages.length - 1];
    assert.equal(last.from, "outside");
    assert.match(last.text, /pricing is ready/);
    assert.ok(s.state.audit.some((a) => /from outside/i.test(a.action)));
  });

  await t.test("it can tick a task off and put it back", async () => {
    const room = (s.state.dealRooms || []).find((r) => r.leadId === leadId)!;
    const taskId = room.tasks[0].id;
    await rpc(route, "tools/call", { name: "complete_task", arguments: { leadId, taskId } });
    assert.equal((s.state.dealRooms || []).find((r) => r.leadId === leadId)!.tasks[0].done, true);
    await rpc(route, "tools/call", { name: "complete_task", arguments: { leadId, taskId, done: false } });
    assert.equal((s.state.dealRooms || []).find((r) => r.leadId === leadId)!.tasks[0].done, false);
  });

  await t.test("a room that is not there, and a tool that is not there, say so instead of throwing", async () => {
    const missing = await said(await rpc(route, "tools/call", { name: "get_deal_room", arguments: { leadId: "co:nobody" } }));
    assert.match(missing.text, /no deal room/i);
    const nonsense = await said(await rpc(route, "tools/call", { name: "do_something_else", arguments: {} }));
    assert.equal(nonsense.isError, true);
  });
});
