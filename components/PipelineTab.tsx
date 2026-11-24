"use client";
// The pipeline board, who moved what (agent or rep), and the numbers that come out of it.
import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { ago } from "@/lib/client";
import { STAGE_NAMES, type Lead, type Stage, type Workspace } from "@/lib/types";
import type { Act } from "./BriefTab";
import { Calendar } from "./Calendar";
import { AGENTS, Empty, Icon, Letter, SectionTitle, Tier } from "./ui";

const COLUMNS: { key: Stage; title: string; holds: Stage[] }[] = [
  { key: "matched", title: "Matched", holds: ["matched"] },
  { key: "contacted", title: "Contacted", holds: ["contacted"] },
  { key: "replied", title: "Replied", holds: ["replied"] },
  { key: "meeting", title: "Meeting booked", holds: ["meeting"] },
  { key: "won", title: "Closed", holds: ["won", "lost"] },
];

const ORDER: Stage[] = ["matched", "contacted", "replied", "meeting", "won"];
const EXAMPLE = "Thanks for reaching out. This is timely for us. Could you do a call on Tuesday at 2pm?";

function Card({ lead, onReply, onOpen, wrote, act, room }: { lead: Lead; onReply: () => void; onOpen: () => void; wrote: number; act: Act; room: boolean }) {
  const contact = lead.contacts[0];
  return (
    <div
      className="boardcard arrive"
      // The whole card can be pressed with a mouse; the company's name is the real button, for the keyboard.
      onClick={onOpen}
      title={wrote ? "Press to read what was written to them" : "Press to open their profile"}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lead", lead.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="flex items-start gap-2">
        <Tier tier={lead.score.tier} />
        <div className="min-w-0 flex-1">
          <button
            className="font-bold text-[14px] leading-snug boardname"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            {lead.company}
          </button>
          {contact && <div className="text-faint text-[12.5px] leading-snug truncate">{contact.name}</div>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className={`chip ${lead.stageBy === "agent" ? "" : "chip-bright"}`} title={`Moved here by ${lead.stageBy === "agent" ? "the agent" : "you"}, ${ago(lead.stageAt)}`}>
          {lead.stageBy === "agent" ? "by agent" : "by you"}
        </span>
        {room && (
          <span className="chip" title="The team has a room for this deal: open the profile to read it">
            Deal room
          </span>
        )}
        {lead.stage === "lost" && <span className="chip chip-line">Lost</span>}
        {lead.stage === "won" && <span className="chip chip-bright">Won</span>}
        {lead.warmPaths.length > 0 && (
          <span className="text-signal" title={lead.warmPaths[0].note}>
            <Icon name="path" size={15} />
          </span>
        )}
        {wrote > 0 && (
          <span className="text-soft inline-flex items-center gap-1 text-[12.5px] font-semibold" title="Press the card to read it">
            <Icon name="mail" size={14} />
            {wrote > 1 ? wrote : ""}
          </span>
        )}
      </div>
      {(lead.stage === "contacted" || lead.stage === "replied") && (
        <button
          className="btn btn-quiet w-full mt-2 !py-1 !text-[13px]"
          onClick={(e) => {
            e.stopPropagation();
            onReply();
          }}
        >
          <Icon name="reply" size={14} />
          Log a reply
        </button>
      )}
      {lead.stage === "meeting" && (
        <div className="flex gap-1.5 mt-2">
          <button
            className="btn btn-quiet flex-1 !py-1 !text-[13px]"
            onClick={(e) => {
              e.stopPropagation();
              act({ type: "stage", leadId: lead.id, stage: "won" });
            }}
          >
            Won
          </button>
          <button
            className="btn btn-plain flex-1 !py-1 !text-[13px]"
            onClick={(e) => {
              e.stopPropagation();
              act({ type: "stage", leadId: lead.id, stage: "lost" });
            }}
          >
            Lost
          </button>
        </div>
      )}
    </div>
  );
}

function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${Math.round((a / b) * 100)}%`;
}

export function PipelineTab({ ws, act, busy, onOpen }: { ws: Workspace; act: Act; busy: Set<string>; onOpen: (leadId: string) => void }) {
  const [over, setOver] = useState<Stage | null>(null);
  const [replyFor, setReplyFor] = useState<Lead | null>(null);
  /** The lead whose messages are being read. */
  const [reading, setReading] = useState<string | null>(null);
  // What was written to each lead: sent first, then what is waiting, newest first within each.
  const written = (leadId: string) => {
    const order = { sent: 0, draft: 1, rejected: 2 };
    return ws.messages.filter((m) => m.leadId === leadId).sort((a, b) => order[a.status] - order[b.status] || (b.decidedAt || b.createdAt).localeCompare(a.decidedAt || a.createdAt));
  };
  const readLead = ws.leads.find((l) => l.id === reading) || null;
  const [text, setText] = useState("");
  const leads = ws.leads.filter((l) => l.status !== "suppressed" || l.stage !== "matched");

  // Which stages each lead has ever reached, from the audit trail.
  const reached = useMemo(() => {
    const map = new Map<string, Set<Stage>>();
    for (const l of ws.leads) map.set(l.id, new Set<Stage>(["matched"]));
    for (const a of ws.audit) if (a.leadId && a.to && map.has(a.leadId)) map.get(a.leadId)!.add(a.to as Stage);
    return map;
  }, [ws.leads, ws.audit]);

  if (ws.leads.length === 0) return <Empty title="No pipeline yet">Accounts enter the board as soon as they are matched.</Empty>;

  const count = (list: Lead[], stage: Stage) => list.filter((l) => reached.get(l.id)?.has(stage)).length;
  const groups = (key: (l: Lead) => string) => {
    const out = new Map<string, Lead[]>();
    for (const l of leads) out.set(key(l), [...(out.get(key(l)) || []), l]);
    return [...out.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  const sent = ws.messages.filter((m) => m.status === "sent");
  const variants = (["A", "B"] as const).map((v) => {
    const list = sent.filter((m) => m.variant === v);
    const replied = list.filter((m) => reached.get(m.leadId)?.has("replied")).length;
    return { v, sent: list.length, replied, angle: list[0]?.angle || (v === "A" ? "Signal-led" : "Problem-led") };
  });
  const moves = ws.audit.filter((a) => a.to && ORDER.includes(a.to as Stage));
  const byAgent = moves.filter((a) => a.actor === "agent").length;

  const submitReply = async () => {
    if (!replyFor) return;
    if (await act({ type: "reply", leadId: replyFor.id, text }, "reply")) {
      setReplyFor(null);
      setText("");
    }
  };

  return (
    <div>
      <Calendar ws={ws} act={act} busy={busy} />
      {/* A column with cards in it gets room for them; an empty one steps back to a narrow rail.
          If there are still too many to fit beside the graph, the board scrolls sideways. */}
      <div className="board" style={{ gridTemplateColumns: COLUMNS.map((col) => (leads.some((l) => col.holds.includes(l.stage)) ? "minmax(160px, 1.5fr)" : "minmax(80px, 0.6fr)")).join(" ") }}>
        {COLUMNS.map((col) => {
          const cards = leads.filter((l) => col.holds.includes(l.stage));
          return (
            <div
              key={col.key}
              className={`boardcol ${cards.length ? "" : "is-empty"} ${over === col.key ? "bg-raise-2" : "bg-raise"}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/lead");
                if (id) act({ type: "stage", leadId: id, stage: col.key });
              }}
            >
              <div className="boardhead">
                <span className="font-bold leading-snug min-w-0">{col.title}</span>
                <span className="count flex-none">{cards.length}</span>
              </div>
              <div className="grid gap-2 grid-cols-[minmax(0,1fr)]">
                {cards.map((l) => (
                  <Card key={l.id} lead={l} act={act} room={(ws.dealRooms || []).some((r) => r.leadId === l.id)} wrote={written(l.id).filter((m) => m.status !== "rejected").length} onReply={() => setReplyFor(l)} onOpen={() => (written(l.id).length ? setReading(l.id) : onOpen(l.id))} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-faint text-[13px] mt-2">Press a card to read what was written to them. Drag it to move it.</div>

      <SectionTitle>How it is going</SectionTitle>
      <div className="grid grid-cols-5 gap-2.5">
        {ORDER.map((stage, i) => {
          const n = count(leads, stage);
          const prev = i ? count(leads, ORDER[i - 1]) : n;
          return (
            <div key={stage} className="rounded-2xl border border-line p-3">
              <div className="label">{STAGE_NAMES[stage]}</div>
              <div className="text-[24px] font-extrabold leading-tight">{n}</div>
              <div className="text-faint text-[12.5px]">{i ? `${pct(n, prev)} of the stage before` : "accounts on the board"}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-6 mt-1">
        <div>
          <SectionTitle>By segment</SectionTitle>
          <table className="w-full text-left text-[14px] border-collapse">
            <thead>
              <tr className="label">
                <th className="font-semibold pb-1">Segment</th>
                <th className="font-semibold pb-1 text-right">Accounts</th>
                <th className="font-semibold pb-1 text-right">Contacted</th>
                <th className="font-semibold pb-1 text-right">Replied</th>
              </tr>
            </thead>
            <tbody>
              {groups((l) => l.segment).map(([name, list]) => (
                <tr key={name} className="rowline">
                  <td className="py-1.5 pr-2">{name}</td>
                  <td className="py-1.5 text-right">{list.length}</td>
                  <td className="py-1.5 text-right">{count(list, "contacted")}</td>
                  <td className="py-1.5 text-right">
                    {count(list, "replied")} <span className="text-faint">({pct(count(list, "replied"), count(list, "contacted"))})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <SectionTitle>By tier</SectionTitle>
          <table className="w-full text-left text-[14px] border-collapse">
            <tbody>
              {groups((l) => `Tier ${l.score.tier}`)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([name, list], i) => (
                  <tr key={name} className={i ? "rowline" : ""}>
                    <td className="py-1.5 pr-2">{name}</td>
                    <td className="py-1.5 text-right">{list.length} accounts</td>
                    <td className="py-1.5 text-right">{count(list, "contacted")} contacted</td>
                    <td className="py-1.5 text-right">{count(list, "replied")} replied</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div>
          <SectionTitle>Message test</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">
            {variants.map((x) => (
              <div key={x.v} className="rounded-2xl border border-line p-3">
                <div className="label">
                  Variant {x.v}: {x.v === "A" ? "signal-led" : "problem-led"}
                </div>
                <div className="text-[22px] font-extrabold leading-tight">
                  {x.replied}/{x.sent}
                </div>
                <div className="text-faint text-[12.5px]">replies per message sent ({pct(x.replied, x.sent)})</div>
              </div>
            ))}
          </div>
          <div className="text-faint text-[12.5px] mt-1.5">With this few messages, read these as counts, not rates.</div>
          <SectionTitle>Who moved the pipeline</SectionTitle>
          <div className="flex items-center gap-3 text-[14px]">
            <div className="bar flex-1" style={{ height: 10 }}>
              <i style={{ width: moves.length ? `${(byAgent / moves.length) * 100}%` : "0%" }} />
            </div>
            <span>
              <span className="font-bold">{byAgent}</span> by the agent, <span className="font-bold">{moves.length - byAgent}</span> by you
            </span>
          </div>
        </div>
      </div>

      <SectionTitle count={ws.audit.length}>Record of every action</SectionTitle>
      <div className="scroll" style={{ maxHeight: 260 }}>
        {[...ws.audit]
          .reverse()
          .slice(0, 40)
          .map((a, i) => {
            const lead = ws.leads.find((l) => l.id === a.leadId);
            return (
              <div key={a.id} className={`grid grid-cols-[76px_92px_1fr] gap-3 py-1.5 text-[13.5px] ${i ? "rowline" : ""}`}>
                <span className="text-faint">{new Date(a.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                <span className={`chip ${a.actor === "rep" ? "chip-bright" : ""} justify-self-start self-start`}>{a.actor === "rep" ? "You" : a.agent ? AGENTS[a.agent].name : "Agent"}</span>
                <span className="leading-snug">
                  <span className="font-semibold">{a.action}</span>
                  {lead ? `: ${lead.company}` : ""}
                  {a.note ? <span className="text-soft">. {a.note}</span> : null}
                </span>
              </div>
            );
          })}
      </div>

      <Dialog.Root open={!!readLead} onOpenChange={(open) => !open && setReading(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="modal modal-wide sheet" aria-describedby={undefined}>
            <div className="flex items-start gap-3">
              <Dialog.Title className="text-[19px] font-extrabold m-0 flex-1 leading-snug">Written to {readLead?.company}</Dialog.Title>
              <Dialog.Close className="btn btn-plain !p-2" aria-label="Close">
                <Icon name="x" />
              </Dialog.Close>
            </div>
            <div className="scroll grid gap-3 mt-3" style={{ maxHeight: "62vh" }}>
              {readLead && written(readLead.id).map((m) => <Letter key={m.id} m={m} when={m.decidedAt ? ago(m.decidedAt) : undefined} />)}
            </div>
            <div className="flex items-center gap-2 mt-4">
              <button
                className="btn"
                onClick={() => {
                  const id = readLead!.id;
                  setReading(null);
                  onOpen(id);
                }}
              >
                Open their profile
              </button>
              <span className="text-faint text-[13px]">Nothing was really sent: this build records the approval only.</span>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={!!replyFor}
        onOpenChange={(open) => {
          if (!open) setReplyFor(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="modal sheet" aria-describedby={undefined}>
            <Dialog.Title className="text-[19px] font-extrabold m-0">Reply from {replyFor?.company}</Dialog.Title>
            <p className="text-soft text-[14px] mt-1 mb-3">Paste what they wrote. The agent reads it, moves the account, puts a meeting on the calendar if they agree to talk, and looks for people this reply can introduce you to.</p>
            <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Their reply" autoFocus aria-label="Reply text" />
            <div className="flex items-center gap-2 mt-4">
              <button className="btn btn-main !py-2" onClick={submitReply} disabled={busy.has("reply") || text.trim().length < 2}>
                {busy.has("reply") ? "Reading" : "Read the reply"}
              </button>
              <button className="btn btn-plain" onClick={() => setText(EXAMPLE)}>
                Use an example reply
              </button>
              <span className="flex-1" />
              <Dialog.Close className="btn btn-plain">Cancel</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
