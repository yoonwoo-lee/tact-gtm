// The deal room: it opens once, it repeats only what was checked, and the client stays out of it
// until a rep puts them in.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TACT_SAMPLE = "1";
process.env.TACT_DATA_DIR = ".data-test";

test("a deal room for an approved send", async (t) => {
  const { GLYPH_FOUNDER, GLYPH_PRODUCT } = await import("../lib/sample/data");
  const p = await import("../lib/pipeline");
  const dr = await import("../lib/dealroom");
  const { store } = await import("../lib/store");
  const s = store();
  s.reset();
  await p.runPipeline(GLYPH_PRODUCT, GLYPH_FOUNDER);

  const draft = s.state.messages.find((m) => m.status === "draft" && m.toEmail);
  assert.ok(draft, "the run should leave a draft with an address on it");
  const lead = s.state.leads.find((l) => l.id === draft!.leadId)!;

  await t.test("no room before anything is approved", () => {
    assert.equal(dr.roomFor(s, lead.id), null);
  });

  p.decideMessage(draft!.id, "approve");

  await t.test("approving opens exactly one room, with the team and their tasks", () => {
    const rooms = (s.state.dealRooms || []).filter((r) => r.leadId === lead.id);
    assert.equal(rooms.length, 1);
    const room = rooms[0];
    assert.equal(room.members.length, 4);
    assert.ok(room.tasks.length >= 3, "sales, marketing and finance each own something");
    assert.ok(room.tasks.every((task) => room.members.some((m) => m.id === task.memberId)));
    assert.equal(room.clientInvited, false);
    assert.equal(room.positiveReply, false);
  });

  await t.test("the brief repeats only what was checked elsewhere", () => {
    const room = dr.roomFor(s, lead.id)!;
    const brief = room.messages[0];
    assert.equal(brief.kind, "brief");
    assert.ok(brief.text.includes(lead.company));
    assert.ok(brief.text.includes(`${lead.score.total}/100`));
    assert.ok(brief.text.includes(draft!.subject), "the email that went out is named");
    // Every sentence of a signal in the brief comes from a signal whose quote our code found.
    for (const sig of lead.signals) {
      if (brief.text.includes(sig.summary)) assert.ok(sig.evidence.verified, `${sig.summary} is in the brief unverified`);
    }
  });

  await t.test("a second approval for the same lead opens no second room", async () => {
    const before = (s.state.dealRooms || []).length;
    const second = await p.draftLead(lead.id, "rep", true);
    if (second) {
      const message = s.state.messages.find((m) => m.id === second.id)!;
      if (!message.toEmail) message.toEmail = draft!.toEmail;
      p.decideMessage(message.id, "approve");
    } else {
      dr.openDealRoom(lead.id);
    }
    assert.equal((s.state.dealRooms || []).length, before);
    assert.equal((s.state.dealRooms || []).filter((r) => r.leadId === lead.id).length, 1);
  });

  await t.test("the client cannot be invited before a reply with interest", () => {
    assert.throws(() => dr.inviteClient(lead.id), /reply with interest/i);
    assert.equal(dr.roomFor(s, lead.id)!.clientInvited, false);
  });

  await t.test("a reply with interest reaches the room and moves the owner's task", async () => {
    await p.logReply(lead.id, "This looks useful. Could you do a call on Tuesday at 2pm?");
    const room = dr.roomFor(s, lead.id)!;
    assert.equal(room.positiveReply, true);
    assert.ok(room.messages.some((m) => m.kind === "reply"));
    const sales = room.members.find((m) => /sales/i.test(m.role))!;
    const task = room.tasks.find((x) => x.memberId === sales.id)!;
    assert.match(task.text, /book the meeting/i);
    const meeting = (s.state.meetings || []).find((m) => m.leadId === lead.id);
    if (meeting) assert.equal(room.meetingId, meeting.id);
  });

  await t.test("only then can a rep invite the client, and it is recorded", () => {
    dr.inviteClient(lead.id);
    const room = dr.roomFor(s, lead.id)!;
    assert.equal(room.clientInvited, true);
    assert.equal(room.invitedBy, "rep");
    assert.ok(room.invitedAt);
    assert.ok(s.state.audit.some((a) => a.actor === "rep" && /invited the client/i.test(a.action) && a.leadId === lead.id));
    assert.throws(() => dr.inviteClient(lead.id), /already/i);
  });

  await t.test("a rep ticks a task off and can put it back", () => {
    const room = dr.roomFor(s, lead.id)!;
    const task = room.tasks[0];
    dr.completeTask(lead.id, task.id, true);
    assert.equal(dr.roomFor(s, lead.id)!.tasks[0].done, true);
    dr.completeTask(lead.id, task.id, false);
    assert.equal(dr.roomFor(s, lead.id)!.tasks[0].done, false);
    assert.equal(dr.roomFor(s, lead.id)!.tasks[0].doneAt, null);
  });

  await t.test("the CEO is only given a task on a tier A lead", () => {
    for (const room of s.state.dealRooms || []) {
      const theirLead = s.state.leads.find((l) => l.id === room.leadId)!;
      const ceo = room.members.find((m) => /ceo/i.test(m.role))!;
      const hasCeoTask = room.tasks.some((task) => task.memberId === ceo.id);
      assert.equal(hasCeoTask, theirLead.score.tier === "A", `${theirLead.company} is tier ${theirLead.score.tier}`);
    }
  });

  await t.test("a lead with no room takes no action", () => {
    const other = s.state.leads.find((l) => !(s.state.dealRooms || []).some((r) => r.leadId === l.id));
    if (!other) return;
    assert.equal(dr.postToDealRoom(other.id, "nobody is listening"), null);
    assert.throws(() => dr.completeTask(other.id, "tk1", true), /no deal room/i);
    assert.throws(() => dr.inviteClient(other.id), /no deal room/i);
  });
});
