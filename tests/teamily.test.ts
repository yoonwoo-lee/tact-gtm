// Teamily, when it is not set up: everything still works and nothing throws.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TACT_SAMPLE = "1";
process.env.TACT_DATA_DIR = ".data-test-teamily";

test("the deal room without Teamily", async (t) => {
  const { modes } = await import("../lib/config");
  const { conversationFor, teamilyPost } = await import("../lib/providers/teamily");

  await t.test("sample mode never calls out, whatever the keys say", () => {
    assert.equal(modes().teamily, false);
  });

  await t.test("a post with it off answers false instead of throwing", async () => {
    assert.equal(await teamilyPost("co:anything", "hello", "once-1"), false);
  });

  await t.test("one deal is one conversation, and the id is stable and safe", () => {
    assert.equal(conversationFor("co:cedar-grove-tutoring"), "deal-co-cedar-grove-tutoring");
    assert.equal(conversationFor("co:cedar-grove-tutoring"), conversationFor("co:cedar-grove-tutoring"));
    assert.notEqual(conversationFor("co:a"), conversationFor("co:b"));
    assert.match(conversationFor("co:odd/name space!"), /^[a-zA-Z0-9_-]+$/);
  });

  await t.test("a room still opens, and the reply still lands, with Teamily off", async () => {
    const { GLYPH_FOUNDER, GLYPH_PRODUCT } = await import("../lib/sample/data");
    const p = await import("../lib/pipeline");
    const dr = await import("../lib/dealroom");
    const { store } = await import("../lib/store");
    const s = store();
    s.reset();
    await p.runPipeline(GLYPH_PRODUCT, GLYPH_FOUNDER);
    const draft = s.state.messages.find((m) => m.status === "draft" && m.toEmail)!;
    p.decideMessage(draft.id, "approve");
    assert.ok(dr.roomFor(s, draft.leadId), "the room opened anyway");
    await p.logReply(draft.leadId, "Yes, interested. Tuesday at 2pm?");
    assert.equal(dr.roomFor(s, draft.leadId)!.positiveReply, true);
  });
});
