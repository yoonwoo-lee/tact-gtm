// The deal room: the moment a rep approves the first email to a company, the people who have to
// do something about it get a room with the deal already written up in it. The brief repeats only
// what was checked somewhere else in this app - a signal with its quote, the score and its parts,
// the warm path, the email that went out. It makes no new claims of its own.
//
// The room is internal. The client is never in it until a rep presses Invite client, and that is
// only offered after they reply with interest.
import { nextId } from "./ids";
import { store, type Store } from "./store";
import { teamilyPost } from "./providers/teamily";
import { DEFAULT_TEAM, type DealRoom, type DealRoomTask, type Lead, type TeamMember } from "./types";

export const team = (s: Store): TeamMember[] => {
  const saved = s.state.settings.team;
  return saved && saved.length > 0 ? saved : DEFAULT_TEAM;
};

const rooms = (s: Store): DealRoom[] => (s.state.dealRooms ||= []);

const lead = (s: Store, leadId: string) => s.state.leads.find((l) => l.id === leadId)?.company || "They";

export const roomFor = (s: Store, leadId: string): DealRoom | null => rooms(s).find((r) => r.leadId === leadId) || null;

/** Match a member by what they do, so an edited team still gets the right tasks. */
const byRole = (members: TeamMember[], word: RegExp) => members.find((m) => word.test(m.role) || word.test(m.name)) || null;

const firstLine = (body: string) => (body.split(/\n+/).find((l) => l.trim().length > 0) || "").trim();

/** The strongest reason to write that carries a quote our code found on the page it cites. */
function strongestSignal(lead: Lead) {
  const checked = lead.signals.filter((sig) => sig.evidence.verified);
  const order = ["hiring", "funding", "leadership", "launch", "expansion", "tech", "other"];
  return [...checked].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0] || null;
}

/** The opening brief: one post from the agent, every line of it already checked. */
function brief(s: Store, lead: Lead): string {
  const sent = [...s.state.messages].reverse().find((m) => m.leadId === lead.id && m.status === "sent");
  const to = lead.contacts.find((c) => c.id === sent?.contactId) || null;
  const signal = strongestSignal(lead);
  const source = signal ? s.state.sources[signal.evidence.sourceId] : null;
  const warm = lead.warmPaths[0] || null;
  const where = [lead.industry, lead.size, lead.location].filter(Boolean).join(", ");
  const lines = [
    `${lead.company}${where ? ` - ${where}` : ""}.`,
    to ? `We wrote to ${to.name}, ${to.title}.` : `We wrote to ${sent?.to || "them"}.`,
    signal ? `Why now: ${signal.summary}${source ? ` (${source.url})` : ""}` : lead.whyNow ? `Why now: ${lead.whyNow}` : "No dated signal: this one came off the fit alone.",
    `Scored ${lead.score.total}/100, tier ${lead.score.tier}. ${lead.score.parts.filter((p) => p.points > 0).map((p) => `${p.label} ${p.points}/${p.max}`).join(", ")}.`,
    warm ? `Way in: ${warm.note}` : "",
    sent ? `The email: "${sent.subject}". It opens "${firstLine(sent.body)}"` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function openingTasks(s: Store, lead: Lead, members: TeamMember[]): DealRoomTask[] {
  const sales = byRole(members, /sales/i);
  const marketing = byRole(members, /marketing/i);
  const finance = byRole(members, /finance/i);
  const ceo = byRole(members, /ceo|chief executive|founder/i);
  const wanted: [TeamMember | null, string][] = [
    [sales, "Own the deal and book the meeting"],
    [marketing, `Prepare a case study that matches ${lead.segment || lead.industry}`],
    [finance, `Prepare pricing for a company this size${lead.size ? ` (${lead.size})` : ""}`],
    // The CEO is only pulled in on the leads that earned it.
    [lead.score.tier === "A" ? ceo : null, `Look over a tier A deal: ${lead.company}`],
  ];
  return wanted
    .filter((pair): pair is [TeamMember, string] => pair[0] !== null)
    .map(([member, text], i) => ({ id: `tk${i + 1}`, memberId: member.id, text, done: false, doneAt: null }));
}

/** Say it in Teamily too, when Teamily is set up. Never waited on, never allowed to throw. */
function mirror(leadId: string, text: string, once: string) {
  void teamilyPost(leadId, text, once).catch(() => {});
}

/**
 * Open the room for a lead. Opening one twice does nothing: the room that is already there is
 * returned unchanged. Called after an approval, and it must never be the reason a send fails.
 */
export function openDealRoom(leadId: string): DealRoom | null {
  const s = store();
  const lead = s.state.leads.find((l) => l.id === leadId);
  if (!lead) return null;
  const already = roomFor(s, leadId);
  if (already) return already;
  const members = team(s);
  const room: DealRoom = {
    id: nextId("dr", rooms(s)),
    leadId,
    members,
    messages: [{ id: "dm1", at: new Date().toISOString(), from: "agent", kind: "brief", text: brief(s, lead) }],
    tasks: openingTasks(s, lead, members),
    positiveReply: false,
    clientInvited: false,
    invitedBy: null,
    invitedAt: null,
    meetingId: null,
    openedAt: new Date().toISOString(),
  };
  rooms(s).push(room);
  s.audit("agent", "Opened a deal room", { agent: "planner", leadId, note: `${members.length} people, ${room.tasks.length} tasks` });
  s.log("planner", "say", `Deal room open for ${lead.company}: the brief is in it and ${room.tasks.length} people have something to do.`, { to: "rep" });
  // And in Teamily, when it is set up: one conversation per deal, opened with the same brief.
  const owes = room.tasks.map((t) => `- ${room.members.find((m) => m.id === t.memberId)?.role || "Somebody"}: ${t.text}`).join("\n");
  mirror(leadId, `Deal room open: ${lead.company}\n\n${room.messages[0].text}\n\nWho owes what:\n${owes}`, `open-${room.id}`);
  s.touch();
  return room;
}

/**
 * Add a line to a room. Returns null when there is no room for that lead yet. `announce` also
 * says it in the agents' feed, which is what carries it into the Band room when Band is set up.
 */
export function postToDealRoom(leadId: string, text: string, kind: "reply" | "note" = "note", announce = false, from = "agent"): DealRoom | null {
  const s = store();
  const room = roomFor(s, leadId);
  if (!room) return null;
  room.messages.push({ id: nextId("dm", room.messages), at: new Date().toISOString(), from, kind, text });
  if (announce) {
    const lead = s.state.leads.find((l) => l.id === leadId);
    s.log("planner", "say", `Deal room${lead ? `, ${lead.company}` : ""}: ${text}`, { to: "rep" });
  }
  s.touch();
  return room;
}

/**
 * A reply came back. The room hears about it, and on a reply with interest the deal owner's task
 * becomes the next thing to do and the meeting on the calendar is linked here.
 */
export function noteReplyInDealRoom(leadId: string, reply: { intent: string; summary: string; next_step: string }): DealRoom | null {
  const s = store();
  const room = roomFor(s, leadId);
  if (!room) return null;
  const positive = reply.intent === "positive";
  postToDealRoom(leadId, [`They replied. ${reply.summary}`, reply.next_step ? `Next: ${reply.next_step}` : ""].filter(Boolean).join(" "), "reply", true);
  if (positive) {
    room.positiveReply = true;
    const meeting = (s.state.meetings || []).find((m) => m.leadId === leadId && m.status !== "cancelled") || null;
    if (meeting) room.meetingId = meeting.id;
    const sales = byRole(room.members, /sales/i);
    const task = room.tasks.find((t) => t.memberId === sales?.id);
    if (task && !task.done) task.text = meeting ? "Book the meeting that is on the calendar" : "Book the meeting";
    if (meeting) postToDealRoom(leadId, `The meeting is on the calendar, waiting for a rep to book it.`, "note");
  }
  mirror(leadId, `${lead(s, leadId)} replied. ${reply.summary}${reply.next_step ? ` Next: ${reply.next_step}` : ""}${positive ? " The meeting is on the calendar, waiting for a rep to book it." : ""}`, `reply-${room.id}-${room.messages.length}`);
  s.touch();
  return room;
}

/** The rep ticks a task off, or puts it back. */
export function completeTask(leadId: string, taskId: string, done: boolean) {
  const s = store();
  const room = roomFor(s, leadId);
  if (!room) throw new Error("There is no deal room for this lead");
  const task = room.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("No such task");
  task.done = done;
  task.doneAt = done ? new Date().toISOString() : null;
  s.audit("rep", done ? "Marked a deal room task done" : "Put a deal room task back", { leadId, note: task.text });
  s.touch();
}

/**
 * Put the client in the room. A rep press only, never the agent's, and only once they have
 * replied with interest. Who pressed it is recorded, like every other approval here.
 */
export function inviteClient(leadId: string) {
  const s = store();
  const room = roomFor(s, leadId);
  if (!room) throw new Error("There is no deal room for this lead");
  if (!room.positiveReply) throw new Error("Wait for a reply with interest before inviting the client in.");
  if (room.clientInvited) throw new Error("The client is already in this room");
  const lead = s.state.leads.find((l) => l.id === leadId);
  room.clientInvited = true;
  room.invitedBy = "rep";
  room.invitedAt = new Date().toISOString();
  postToDealRoom(leadId, "A rep invited the client into this room. Everything said from here is said in front of them.", "note");
  s.audit("rep", "Invited the client into the deal room", { leadId, note: lead ? lead.company : "" });
  s.touch();
}

/** The rooms, flattened for something reading them from outside (the MCP tools). */
export function listDealRooms() {
  const s = store();
  return rooms(s).map((room) => {
    const lead = s.state.leads.find((l) => l.id === room.leadId);
    return {
      leadId: room.leadId,
      company: lead?.company || room.leadId,
      tier: lead?.score.tier || null,
      score: lead?.score.total ?? null,
      stage: lead?.stage || null,
      openTasks: room.tasks.filter((t) => !t.done).length,
      clientInvited: room.clientInvited,
      positiveReply: room.positiveReply,
      openedAt: room.openedAt,
    };
  });
}

/** One room in full: the brief, every line said in it, and who owns what. */
export function getDealRoom(leadId: string) {
  const s = store();
  const room = roomFor(s, leadId);
  if (!room) return null;
  const lead = s.state.leads.find((l) => l.id === room.leadId);
  const who = (id: string) => room.members.find((m) => m.id === id)?.role || id;
  return {
    leadId: room.leadId,
    company: lead?.company || room.leadId,
    members: room.members.map((m) => ({ id: m.id, role: m.role, name: m.name })),
    messages: room.messages.map((m) => ({ at: m.at, from: m.from === "agent" ? "agent" : who(m.from), kind: m.kind, text: m.text })),
    tasks: room.tasks.map((t) => ({ id: t.id, owner: who(t.memberId), text: t.text, done: t.done })),
    positiveReply: room.positiveReply,
    clientInvited: room.clientInvited,
    meetingId: room.meetingId,
  };
}
