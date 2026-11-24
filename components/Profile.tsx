"use client";
// The profile card: one entry per company, like a field guide. It opens on the three things
// that decide whether to write: who to write to, why now, and the way in. The rest (the other
// people there, how the score was reached, the proof) is one click away, folded. Arrow keys
// flip entries.
import { cleanDomain } from "@/lib/logo";
import { useLogo } from "./logos";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { COSTS, type Competitor, type Contact, type DealRoom, type Lead, type Workspace } from "@/lib/types";
import type { Act } from "./BriefTab";
import { EmailChip } from "./LeadsTab";
import { COST_NOTE, type LeadView } from "./leads";
import { Icon, Monogram, Quote, Score, initials, WayIn } from "./ui";

// Drawn on a patch of the field, in the colors the big graph uses.
const TIER_STROKE = { A: "#1B1640", B: "rgba(27,22,64,.6)", C: "rgba(27,22,64,.36)" } as const;

/** The entry's own small graph: the company, the people found there, its reasons to write, and
    the shared school or employer that makes a warm way in. Drawn the way the big graph draws them. */
function Sprite({ lead, to }: { lead: Lead; to: Contact | null }) {
  const cx = 78, cy = 56;
  const people = lead.contacts.slice(0, 5);
  const signals = lead.signals.slice(0, 3);
  const fan = (n: number, i: number, mid: number, spread: number) => ((mid + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread)) * Math.PI) / 180;
  const at = (angle: number, r: number) => ({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  const P = people.map((c, i) => ({ c, ...at(fan(people.length, i, 0, people.length > 2 ? 110 : 64), 46) }));
  const S = signals.map((s, i) => ({ s, ...at(fan(signals.length, i, 180, signals.length > 2 ? 100 : 56), 44) }));
  const warm = lead.warmPaths[0];
  const warmAt = warm ? P.find((p) => p.c.id === warm.contactId) : null;
  // The company's own logo when its website publishes one, else its initials.
  const logo = useLogo(cleanDomain(lead.domain));
  return (
    <svg viewBox="0 0 200 112" className="sprite" role="img" aria-label={`${lead.company}: ${people.length} people and ${signals.length} reasons to write found`}>
      {[...S, ...P].map(({ x, y }, i) => (
        <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(27,22,64,.3)" strokeWidth="1.1" />
      ))}
      {warm && warmAt && (
        <>
          <path className="sprite-way" d={`M${warmAt.x} ${warmAt.y} L160 24 L184 56`} fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeDasharray="5 4" />
          <rect x="154" y="18" width="12" height="12" rx="3" fill="#FFFFFF" stroke="#1B1640" strokeWidth="1.5" />
          <circle cx="184" cy="56" r="5.500" fill="#5A34D6" stroke="#FFFFFF" strokeWidth="2" />
          <text x="184" y="74" textAnchor="middle" className="sprite-t">you</text>
        </>
      )}
      {S.map(({ s, x, y }) => (
        <path key={s.id} d={`M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`} fill="#5A34D6" stroke="#FFFFFF" strokeWidth="1.5">
          <title>{s.summary}</title>
        </path>
      ))}
      {P.map(({ c, x, y }) => (
        <g key={c.id}>
          {to?.id === c.id && <circle cx={x} cy={y} r="9" fill="none" stroke="#1B1640" strokeWidth="1.400" />}
          <circle cx={x} cy={y} r="5" fill={to?.id === c.id ? "#1B1640" : "#4A4585"} stroke="#FFFFFF" strokeWidth="2">
            <title>{`${c.name}, ${c.title}`}</title>
          </circle>
        </g>
      ))}
      <circle cx={cx} cy={cy} r="22" fill="#FFFFFF" stroke={TIER_STROKE[lead.score.tier]} strokeWidth={lead.score.tier === "A" ? 2.800 : 2} strokeDasharray={lead.status === "suppressed" ? "3 3" : undefined} />
      {logo ? (
        <image href={logo} x={cx - 16} y={cy - 16} width="32" height="32" preserveAspectRatio="xMidYMid meet" />
      ) : (
        <text x={cx} y={cy + 0.500} textAnchor="middle" dominantBaseline="middle" className="sprite-i">
          {initials(lead.company)}
        </text>
      )}
    </svg>
  );
}

function linkedinFor(c: Contact, company: string, sample: boolean): { href: string | null; label: string; note: string } {
  if (c.linkedin && /linkedin\.com/i.test(c.linkedin)) return { href: c.linkedin, label: "LinkedIn", note: "Their profile, as found in the sources" };
  if (sample) return { href: null, label: "LinkedIn", note: "Sample person: there is no real profile to open" };
  return { href: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} ${company}`)}`, label: "Find on LinkedIn", note: "No profile address was in the sources, so this searches LinkedIn for the name and company" };
}

function LinkedIn({ c, lead, sample }: { c: Contact; lead: Lead; sample: boolean }) {
  const li = linkedinFor(c, lead.company, sample);
  return li.href ? (
    <a className="chip chip-link" href={li.href} target="_blank" rel="noreferrer noopener" title={li.note}>
      <Icon name="linkedin" size={14} />
      {li.label}
      <Icon name="out" size={12} />
    </a>
  ) : (
    <span className="chip chip-line" title={li.note}>
      <Icon name="linkedin" size={14} />
      {li.label}
    </span>
  );
}

/** A part of the card that stays shut until it is asked for. */
function More({ title, count, children, open: start = false }: { title: string; count?: number; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(start);
  const ref = useRef<HTMLDivElement>(null);
  // What was asked for should be seen: bring it up from under the foot of the card.
  useEffect(() => {
    if (open && !start) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, start]);
  return (
    <div className="more" ref={ref}>
      <button className="more-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }}>
          <Icon name="right" size={15} />
        </span>
        <span>{title}</span>
        {count != null && <span className="count">{count}</span>}
      </button>
      {open && <div className="more-body arrive">{children}</div>}
    </div>
  );
}

/**
 * The deal room: who is on this deal inside the company, what the agent told them, and what each
 * of them has to do. The client is not in here. The button that puts them in only appears once
 * they have replied with interest, and pressing it is the rep's, not the agent's.
 */
function DealRoomPanel({ room, lead, ws, act, busy }: { room: DealRoom; lead: Lead; ws: Workspace; act: Act; busy: Set<string> }) {
  const who = (id: string) => room.members.find((m) => m.id === id) || null;
  const meeting = room.meetingId ? (ws.meetings || []).find((m) => m.id === room.meetingId) || null : null;
  return (
    <div className="grid gap-4">
      <div className="flex gap-1.5 flex-wrap">
        {room.members.map((m) => (
          <span key={m.id} className="chip !py-1.5 !px-3" title={m.role}>
            <Monogram name={m.name} size={20} />
            {m.role}
          </span>
        ))}
        {room.clientInvited && (
          <span className="chip chip-bright !py-1.5 !px-3">
            <Icon name="check" size={13} />
            Client invited
          </span>
        )}
      </div>

      <div className="grid gap-2.5">
        {room.messages.map((m) => (
          <div key={m.id} className="box p-3">
            <div className="text-faint text-[12px] mb-1.5">
              {m.from === "outside" ? "Said from outside this app" : m.kind === "brief" ? "The brief" : m.kind === "reply" ? "Their reply" : "Note"}
            </div>
            <div className="text-[14px] leading-relaxed whitespace-pre-line">{m.text}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        {room.tasks.map((task) => (
          <label key={task.id} className="person !cursor-pointer" style={{ opacity: task.done ? 0.6 : 1 }}>
            <input
              type="checkbox"
              checked={task.done}
              disabled={busy.has(`task-${task.id}`)}
              onChange={(e) => act({ type: "task", leadId: lead.id, taskId: task.id, done: e.target.checked }, `task-${task.id}`)}
              aria-label={task.text}
            />
            <div className="min-w-0 flex-1 leading-snug">
              <div className={task.done ? "line-through" : "font-semibold"}>{task.text}</div>
              <div className="text-soft text-[13px]">{who(task.memberId)?.role || "Somebody"}</div>
            </div>
          </label>
        ))}
      </div>

      {meeting && (
        <div className="text-[13.5px] text-soft">
          The meeting from their reply is on the calendar{meeting.status === "booked" ? ", booked" : ", waiting for you to book it"}.
        </div>
      )}

      {room.positiveReply && !room.clientInvited && (
        <div className="waybox p-3.5 flex gap-2.5 items-center">
          <div className="flex-1 text-[13.5px] leading-snug">They replied with interest. Bringing them in here is your call, not the agent&apos;s.</div>
          <button className="btn" disabled={busy.has("invite")} onClick={() => act({ type: "inviteClient", leadId: lead.id }, "invite")}>
            Invite client
          </button>
        </div>
      )}
    </div>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return <h3 className="dex-h">{children}</h3>;
}

export function Profile({
  view,
  focus,
  index,
  total,
  isBest,
  ws,
  act,
  busy,
  onClose,
  onStep,
  onShowPath,
  onDraft,
  onReview,
}: {
  view: LeadView | null;
  focus: string | null;
  index: number;
  total: number;
  isBest: boolean;
  ws: Workspace;
  act: Act;
  busy: Set<string>;
  onClose: () => void;
  onStep: (by: 1 | -1) => void;
  onShowPath: (lead: Lead) => void;
  onDraft: (lead: Lead, force?: boolean) => void;
  onReview: () => void;
}) {
  const sample = ws.modes.llm === "sample" || ws.modes.search === "sample";
  return (
    <Dialog.Root open={!!view} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        {view && (
          <Dialog.Content
            className="dex sheet"
            aria-describedby={undefined}
            // Focus the card itself, not its first button: the arrow keys then flip entries at once.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).focus();
            }}
            onKeyDown={(e) => {
              const typing = (e.target as HTMLElement).tagName === "INPUT";
              if (typing) return;
              if (e.key === "ArrowRight") onStep(1);
              if (e.key === "ArrowLeft") onStep(-1);
            }}
          >
            <Entry key={view.lead.id} view={view} focus={focus} index={index} total={total} isBest={isBest} ws={ws} act={act} busy={busy} sample={sample} onStep={onStep} onShowPath={onShowPath} onDraft={onDraft} onReview={onReview} />
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Entry({
  view,
  focus,
  index,
  total,
  isBest,
  ws,
  act,
  busy,
  sample,
  onStep,
  onShowPath,
  onDraft,
  onReview,
}: {
  view: LeadView;
  focus: string | null;
  index: number;
  total: number;
  isBest: boolean;
  ws: Workspace;
  act: Act;
  busy: Set<string>;
  sample: boolean;
  onStep: (by: 1 | -1) => void;
  onShowPath: (lead: Lead) => void;
  onDraft: (lead: Lead, force?: boolean) => void;
  onReview: () => void;
}) {
  const { lead, contact, draft, sent, signal } = view;
  const [domain, setDomain] = useState("");
  const room = (ws.dealRooms || []).find((r) => r.leadId === lead.id) || null;
  // Opened from a person on the graph who is not the one to write to: show the others straight away.
  const others = lead.contacts.filter((c) => c.id !== contact?.id);
  const focusOther = !!focus && others.some((c) => c.id === focus);
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOther) focusRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusOther]);
  const running = ws.run.status === "running";
  const writing = busy.has(`d:${lead.id}`);
  const finding = busy.has(`e:${lead.id}`);
  const warm = lead.warmPaths[0];
  const moreSignals = lead.signals.filter((s) => s !== signal);
  const proof = moreSignals.length + lead.evidence.length + (lead.usesCompetitor ? 1 : 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <>
      <div className="dex-top">
        <button className="btn btn-plain !p-1.5" onClick={() => onStep(-1)} aria-label="Previous profile" disabled={total < 2}>
          <Icon name="left" size={18} />
        </button>
        <span className="num text-[13px] text-soft">
          {pad(index + 1)} <span className="text-faint">of {pad(total)}</span>
        </span>
        <button className="btn btn-plain !p-1.5" onClick={() => onStep(1)} aria-label="Next profile" disabled={total < 2}>
          <Icon name="right" size={18} />
        </button>
        {isBest && (
          <span className="chip chip-bright ml-1">
            <Icon name="star" size={13} />
            Best to contact first
          </span>
        )}
        {lead.status === "held" && <span className="chip chip-flag ml-1">On hold: no reason to write yet</span>}
        {lead.status === "suppressed" && <span className="chip chip-flag ml-1">Left out</span>}
        <span className="flex-1" />
        <Dialog.Close className="btn btn-plain !p-2" aria-label="Close">
          <Icon name="x" />
        </Dialog.Close>
      </div>

      <div className="dex-hero">
        <div className="dex-window">
          <div className="dots absolute inset-0" />
          <Sprite lead={lead} to={contact} />
        </div>
        <div className="min-w-0 flex-1">
          <Dialog.Title className="text-[22px] font-extrabold leading-tight tracking-tight m-0">{lead.company}</Dialog.Title>
          <div className="text-soft text-[14px] leading-snug mt-1 line-clamp-2">{[lead.segment, lead.location].filter(Boolean).join(", ")}</div>
          {lead.domain && (
            <a className="dex-site" href={sample ? undefined : `https://${lead.domain}`} target="_blank" rel="noreferrer noopener" title={sample ? "Sample company: not a real site" : undefined}>
              <Icon name="globe" size={15} />
              {lead.domain}
              {!sample && <Icon name="out" size={12} />}
            </a>
          )}
        </div>
        <div className="flex-none">
          <Score total={lead.score.total} tier={lead.score.tier} size={42} />
        </div>
      </div>

      <div className="dex-main scroll">
        {lead.status !== "active" && (
          <div className="rounded-xl bg-flag p-3.5 mb-5 text-[14px]">
            <span className="font-bold">{lead.status === "held" ? "On hold. " : "Left out. "}</span>
            {lead.status === "held" ? "It fits, but nothing says they are buying now, so no message was written." : lead.negative?.signal}
            {lead.negative?.evidence && (
              <div className="mt-2">
                <Quote evidence={lead.negative.evidence} sources={ws.sources} />
              </div>
            )}
          </div>
        )}

        <Head>Who to write to</Head>
        {contact ? (
          <div className={`person is-main ${focus === contact.id ? "is-focus" : ""}`}>
            <Monogram name={contact.name} size={48} bright />
            <div className="min-w-0 flex-1">
              <div className="font-extrabold text-[18px] leading-tight">{contact.name}</div>
              <div className="text-soft text-[14px] leading-snug">{contact.title}</div>
              <div className="flex gap-1.5 flex-wrap mt-2 items-center">
                <EmailChip c={contact} />
                {!contact.email && lead.domain && !lead.enriched && (
                  <button className="btn btn-quiet !py-0.5 !px-2.5 !text-[12.5px]" disabled={finding || running} onClick={() => act({ type: "enrich", leadId: lead.id }, `e:${lead.id}`)} title={COST_NOTE.emails(COSTS["lead.enriched"])}>
                    {finding ? "Looking" : "Find emails"}
                  </button>
                )}
                <LinkedIn c={contact} lead={lead} sample={sample} />
              </div>
            </div>
          </div>
        ) : (
          <div className="box p-3.5 text-soft text-[14px] flex items-center gap-3">
            <span className="flex-1">Nobody is named in the sources yet.</span>
            {lead.domain && (
              <button className="btn" disabled={finding || running} onClick={() => act({ type: "enrich", leadId: lead.id }, `e:${lead.id}`)} title={COST_NOTE.emails(COSTS["lead.enriched"])}>
                {finding ? "Looking" : "Find people and emails"}
              </button>
            )}
          </div>
        )}

        <Head>Why now</Head>
        {signal ? (
          <div>
            <div className="font-semibold leading-snug mb-1.5">{signal.summary}</div>
            <Quote evidence={signal.evidence} sources={ws.sources} />
          </div>
        ) : (
          <div className="text-faint text-sm">No reason to write was found.</div>
        )}

        {warm && (
          <>
            <Head>A warm way in</Head>
            <div className="waybox p-3.5">
              <div className="flex gap-2.5 items-center">
                <span className="text-signal">
                  <Icon name="path" size={18} />
                </span>
                <div className="flex-1 leading-snug">
                  <WayIn warm={warm} who={lead.contacts.find((c) => c.id === warm.contactId)?.name} />
                </div>
                <button className="btn !text-[13.5px] !py-1 !px-3" onClick={() => onShowPath(lead)}>
                  Show on graph
                </button>
              </div>
            </div>
          </>
        )}

        <div className="mt-6">
          {others.length > 0 && (
            <More title="Other people here" count={others.length} open={focusOther}>
              <div className="grid gap-2">
                {others.map((c) => (
                  <div key={c.id} ref={focus === c.id ? focusRef : undefined} className={`person ${focus === c.id ? "is-focus" : ""}`}>
                    <Monogram name={c.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="leading-snug">
                        <span className="font-bold">{c.name}</span> <span className="text-soft text-[14px]">{c.title}</span>
                      </div>
                      <div className="flex gap-1.5 flex-wrap mt-1.5">
                        <EmailChip c={c} />
                        <LinkedIn c={c} lead={lead} sample={sample} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </More>
          )}
          {room && (
            <More title="Deal room" count={room.tasks.filter((t) => !t.done).length} open={room.positiveReply && !room.clientInvited}>
              <DealRoomPanel room={room} lead={lead} ws={ws} act={act} busy={busy} />
            </More>
          )}
          <More title={`Why it scored ${lead.score.total}/100`}>
            {lead.summary && <p className="m-0 mb-4 text-[14.5px] leading-relaxed text-soft">{lead.summary}</p>}
            <div className="grid gap-2.5">
              {lead.score.parts.map((p) => (
                <div key={p.label} className="grid grid-cols-[124px_90px_44px_minmax(0,1fr)] items-center gap-3 text-[13.5px]">
                  <span className="font-semibold">{p.label}</span>
                  <span className="bar">
                    <i style={{ width: `${(p.points / p.max) * 100}%` }} />
                  </span>
                  <span className="num text-[12px] text-soft">
                    {p.points}/{p.max}
                  </span>
                  <span className="text-faint leading-snug truncate" title={p.note}>
                    {p.note}
                  </span>
                </div>
              ))}
            </div>
          </More>
          {proof > 0 && (
            <More title="More proof" count={proof}>
              <div className="grid gap-3.5">
                {moreSignals.map((s) => (
                  <div key={s.id}>
                    <div className="font-semibold leading-snug mb-1">{s.summary}</div>
                    <Quote evidence={s.evidence} sources={ws.sources} />
                  </div>
                ))}
                {lead.evidence.map((e, i) => (
                  <Quote key={i} evidence={e} sources={ws.sources} />
                ))}
                {lead.usesCompetitor && (
                  <div>
                    <div className="font-semibold mb-1">Uses {lead.usesCompetitor.name}</div>
                    <Quote evidence={lead.usesCompetitor.evidence} sources={ws.sources} />
                  </div>
                )}
              </div>
            </More>
          )}
        </div>

        {!lead.domain && lead.status !== "suppressed" && (
          <div className="box p-3.5 mt-5">
            <div className="font-semibold text-[14px] mb-2">No website was shown in the sources. Add it to look up the people there.</div>
            <div className="flex gap-2">
              <input className="input !py-1.5" placeholder="company.com" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Company website" />
              <button className="btn" onClick={() => act({ type: "domain", leadId: lead.id, domain })}>
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {lead.status !== "suppressed" && (
        <div className="dex-foot">
          {sent ? (
            <span className="chip !py-1.5 !px-3">
              <span className="text-good">
                <Icon name="check" size={14} />
              </span>
              Sent after your approval
            </span>
          ) : draft ? (
            <>
              <button className="btn btn-main" onClick={onReview}>
                <span className="waitdot" />
                Review draft
              </button>
              <span className="text-faint text-[13px]">It goes nowhere until you approve it.</span>
            </>
          ) : (
            <>
              <button className="btn btn-main" disabled={writing || running} onClick={() => onDraft(lead, true)} title={COST_NOTE.draft(COSTS["outreach.drafted"])}>
                <Icon name="edit" />
                {writing ? "Writing" : "Draft a message"}
              </button>
              <span className="text-faint text-[13px]">Nothing is sent until you approve it.</span>
            </>
          )}
          <span className="flex-1" />
          <button className="btn btn-plain" onClick={() => act({ type: "suppress", leadId: lead.id })}>
            Do not contact
          </button>
        </div>
      )}
    </>
  );
}

/** The same kind of card for a competitor: what it is, what it costs, where we are better, and who uses it. */
export function CompetitorCard({ competitor, ws, onClose, onOpenLead }: { competitor: Competitor | null; ws: Workspace; onClose: () => void; onOpenLead: (id: string) => void }) {
  const users = competitor ? ws.leads.filter((l) => l.usesCompetitor?.name.toLowerCase() === competitor.name.toLowerCase()) : [];
  return (
    <Dialog.Root open={!!competitor} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        {competitor && (
          <Dialog.Content
            className="dex dex-small sheet"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).focus();
            }}
          >
            <div className="dex-top">
              <span className="chip chip-line">Competitor, {competitor.category}</span>
              <span className="flex-1" />
              <Dialog.Close className="btn btn-plain !p-2" aria-label="Close">
                <Icon name="x" />
              </Dialog.Close>
            </div>
            <div className="dex-main scroll">
              <div className="flex items-center gap-3.5">
                <Monogram name={competitor.name} size={52} square />
                <div className="min-w-0">
                  <Dialog.Title className="text-[21px] font-extrabold leading-tight tracking-tight m-0">{competitor.name}</Dialog.Title>
                  {competitor.pricing && <div className="text-soft text-[14px]">{competitor.pricing}</div>}
                </div>
              </div>
              <p className="mt-4 mb-0 text-[15px] leading-relaxed">{competitor.positioning}</p>
              <Head>Where {ws.product?.name || "we"} wins</Head>
              <div className="box p-3.5 text-[14.5px] leading-relaxed">{competitor.ourEdge}</div>
              {users.length > 0 && (
                <>
                  <Head>Leads using it</Head>
                  <div className="flex gap-1.5 flex-wrap">
                    {users.map((l) => (
                      <button key={l.id} className="btn !py-1" onClick={() => onOpenLead(l.id)}>
                        {l.company}
                        <Icon name="right" size={14} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              {competitor.evidence.length > 0 && (
                <More title="Proof" count={competitor.evidence.length}>
                  <div className="grid gap-3">
                    {competitor.evidence.map((e, i) => (
                      <Quote key={i} evidence={e} sources={ws.sources} />
                    ))}
                  </div>
                </More>
              )}
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
