// Shared shapes for the whole app. Server and client both import from here.

export type NodeLabel = "Product" | "Company" | "Person" | "Competitor" | "Signal" | "School" | "JobPost";

export type EdgeType =
  | "WORKS_AT"
  | "PREVIOUSLY_EMPLOYED_AT"
  | "STUDIED_AT"
  | "COMPETES_WITH"
  | "MATCHED_TO"
  | "CONTACTED_VIA"
  | "REPLIED_TO"
  | "ABOUT"
  | "USES"
  | "POSTED"
  | "NEEDS";

export type Props = Record<string, string | number | boolean | null>;

export interface GNode {
  id: string;
  label: NodeLabel;
  name: string;
  props: Props;
}

export interface GEdge {
  id: string;
  type: EdgeType;
  from: string;
  to: string;
  props: Props;
}

/** A page or record something was read from. Every fact on screen points at one of these. */
export interface Source {
  id: string;
  url: string;
  title: string;
  text: string; // what was actually retrieved; quotes are checked against this
  provider: "tavily" | "gemini" | "hunter" | "sample";
  fetchedAt: string;
}

/** A quote taken from a source. `verified` means our code found the quote in the retrieved text. */
export interface Evidence {
  sourceId: string;
  quote: string;
  verified: boolean;
}

export interface IcpIndustry {
  name: string;
  naics: string | null;
  confidence: number;
  why: string;
}

export interface IcpPersona {
  title: string;
  seniority: string;
  function: string;
  caresAbout: string;
  confidence: number;
}

export interface IcpTrigger {
  event: string;
  whyItMatters: string;
  confidence: number;
}

export interface IcpExpansion {
  id: string;
  segment: string;
  reasoning: string;
  confidence: number;
  status: "suggested" | "accepted" | "dismissed";
}

export interface SearchPlanItem {
  query: string;
  purpose: "accounts" | "signals" | "competitors";
  segment: string;
}

export interface ICP {
  summary: string;
  industries: IcpIndustry[];
  companySize: { headcount: string; revenue: string; confidence: number; why: string };
  personas: IcpPersona[];
  triggers: IcpTrigger[];
  negatives: { signal: string; why: string }[];
  regions: string[];
  expansions: IcpExpansion[];
  searchPlan: SearchPlanItem[];
}

export type SignalKind = "hiring" | "funding" | "launch" | "leadership" | "tech" | "expansion" | "other";

export interface Signal {
  id: string;
  kind: SignalKind;
  summary: string;
  date: string | null; // ISO date when the source gives one
  evidence: Evidence;
}

/**
 * A public job posting: the buying signal the Hiring Radar watches. A posting is only kept when
 * its quote is on the page it cites, like every other fact here.
 */
export interface JobPost {
  id: string;
  companyId: string;
  title: string;
  team: string | null;
  /** Who the role reports to, when the posting says. That person is usually the buyer. */
  reportsTo: string | null;
  date: string | null; // ISO date the posting went up, when the page gives one
  url: string;
  /** "first", "founding", "build the team": a new function, not a backfill. */
  firstHire: boolean;
  /** The hiring Signal this posting backs. */
  signalId: string;
  evidence: Evidence;
}

export interface Contact {
  id: string;
  name: string;
  title: string;
  seniority: string;
  linkedin: string | null;
  email: string | null;
  emailStatus: "verified" | "unverified" | "guess" | null;
  emailConfidence: number | null;
  emailSource: string | null;
  evidence: Evidence[];
}

/** A way to reach someone that is better than a cold email. */
export interface WarmPath {
  kind: "shared_school" | "shared_employer" | "referral";
  contactId: string;
  via: string; // the school, employer or person in the middle
  viaId: string;
  hops: string[]; // node ids along the path, founder first
  note: string;
  evidence: Evidence | null;
}

export type Stage = "matched" | "contacted" | "replied" | "meeting" | "won" | "lost";
export const STAGES: Stage[] = ["matched", "contacted", "replied", "meeting", "won", "lost"];
export const STAGE_NAMES: Record<Stage, string> = {
  matched: "Matched",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting booked",
  won: "Closed",
  lost: "Lost",
};

export type Actor = "agent" | "rep";

export interface ScorePart {
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface LeadScore {
  total: number; // 0 to 100
  fit: number;
  intent: number;
  tier: "A" | "B" | "C";
  parts: ScorePart[];
}

export interface Lead {
  id: string; // the Company node id
  company: string;
  domain: string | null;
  industry: string;
  size: string | null;
  location: string | null;
  segment: string;
  summary: string;
  evidence: Evidence[];
  signals: Signal[];
  /** Postings the Radar found. Left out of older saved workspaces, so read it as `|| []`. */
  jobPosts?: JobPost[];
  contacts: Contact[];
  usesCompetitor: { name: string; evidence: Evidence } | null;
  negative: { signal: string; evidence: Evidence | null } | null;
  warmPaths: WarmPath[];
  score: LeadScore;
  whyNow: string | null;
  /** held: the agent found no reason to write yet. suppressed: a negative signal or do-not-contact. */
  status: "active" | "held" | "suppressed";
  enriched: boolean;
  stage: Stage;
  stageBy: Actor;
  stageAt: string;
}

export interface Competitor {
  id: string;
  name: string;
  category: "direct" | "indirect" | "alternative";
  positioning: string;
  pricing: string | null;
  ourEdge: string;
  evidence: Evidence[];
}

/** One numbered fact handed to the writer. The reviewer checks every claim against these. */
export interface Fact {
  n: number;
  text: string;
  sourceId: string | null;
  kind: "signal" | "company" | "contact" | "warm_path" | "product" | "competitor";
}

export interface Claim {
  text: string;
  fact: number | null;
  supported: boolean;
  note: string;
  /** The rep chose to keep it although nothing backs it. Never set by an agent. */
  kept?: boolean;
  /** The rep deleted its sentence. It is not looked for in the message again: the plain subject
      that replaces a deleted subject can be worded much like the claim it replaced. */
  removed?: boolean;
}

export interface Message {
  id: string;
  leadId: string;
  contactId: string | null;
  to: string; // display name
  toEmail: string | null;
  variant: "A" | "B";
  angle: string;
  subject: string;
  body: string;
  linkedinNote: string;
  facts: Fact[];
  claims: Claim[];
  review: { verdict: "pass" | "revised" | "needs_human"; rounds: number; notes: string[] };
  security: { ok: boolean; notes: string[] };
  status: "draft" | "sent" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  editedByRep: boolean;
}

export type AgentName = "planner" | "builder" | "reviewer" | "security" | "system" | "rep";

export interface Activity {
  seq: number;
  at: string;
  agent: AgentName;
  /** say: a message to another agent or the rep. step: work it did. query: a graph query. flag: something it stopped. */
  kind: "say" | "step" | "query" | "flag" | "error";
  to: AgentName | null;
  text: string;
  detail: string | null; // a Cypher query, a list of dropped claims, ...
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: Actor;
  agent: AgentName | null;
  action: string;
  leadId: string | null;
  messageId: string | null;
  from: string | null;
  to: string | null;
  note: string;
}

export interface LedgerEntry {
  at: string;
  event: "discovery.run" | "lead.enriched" | "outreach.drafted" | "outreach.sent" | "graph.query" | "credits.topup" | "radar.scan";
  credits: number; // negative = spent
  ref: string;
  synced: "sent" | "failed" | "local";
}

export interface Credits {
  balance: number;
  ledger: LedgerEntry[];
  flexprice: { configured: boolean; accepted: number; failed: number; wallet: number | null; lastError: string | null };
}

export interface RunStats {
  searches: number;
  sources: number;
  claimsProposed: number;
  claimsVerified: number;
  claimsDropped: number;
  companiesDropped: number;
  graphQueries: number;
  llmCalls: number;
  /** Lookups in this run that were answered from saved copies (lib/cache.ts) instead of the network. */
  replayed: number;
}

export interface Modes {
  llm: "gemini" | "sample";
  search: "tavily" | "gemini" | "sample";
  enrich: "hunter" | "sample";
  graph: "neo4j" | "embedded";
  billing: "flexprice" | "local";
  band: boolean;
  /** Deal rooms mirrored into a Teamily conversation, one per deal. */
  teamily: boolean;
  send: "simulate";
}

export interface Product {
  name: string;
  description: string;
  url: string;
  pricing: string;
  customers: string;
}

export interface Founder {
  name: string;
  schools: string[];
  employers: string[];
}

/** A conversation with a lead. The agent proposes one when a reply agrees to talk; only the rep books it. */
export interface Meeting {
  id: string;
  leadId: string;
  contactId: string | null;
  title: string;
  /** Wall-clock time on the rep's machine, "YYYY-MM-DDTHH:MM". */
  start: string;
  minutes: number;
  status: "proposed" | "booked" | "cancelled";
  /** The reply named both a day and a time. If not, `start` is only a suggestion. */
  exact: boolean;
  /** What the reply said, and who to invite: goes into the calendar entry. */
  note: string;
  createdAt: string;
}

/** One person in the team that works a deal: a name, what they do, and an optional chat handle. */
export interface TeamMember {
  id: string;
  name: string;
  role: string;
  handle?: string | null;
}

/** Who a deal room opens with until the team is edited. Roles, not real people. */
export const DEFAULT_TEAM: TeamMember[] = [
  { id: "tm1", name: "CEO", role: "CEO", handle: null },
  { id: "tm2", name: "Sales Director", role: "Sales Director", handle: null },
  { id: "tm3", name: "Marketing Director", role: "Marketing Director", handle: null },
  { id: "tm4", name: "Finance Director", role: "Finance Director", handle: null },
];

/** A line in a deal room. `from` is a member id, or "agent" for the agent's own posts. */
export interface DealRoomMessage {
  id: string;
  at: string;
  from: string;
  kind: "brief" | "reply" | "note";
  text: string;
}

/** A piece of the deal somebody owns. The rep ticks it off; the agent only rewords it. */
export interface DealRoomTask {
  id: string;
  memberId: string;
  text: string;
  done: boolean;
  doneAt: string | null;
}

/**
 * The internal room a deal gets the moment its first email is recorded as sent: the team, the
 * brief, and who owns what. The client is never in it until a rep presses Invite client, which
 * is only offered once they have replied with interest.
 */
export interface DealRoom {
  id: string;
  leadId: string;
  members: TeamMember[];
  messages: DealRoomMessage[];
  tasks: DealRoomTask[];
  /** Set when a reply comes back with interest: what unlocks Invite client. */
  positiveReply: boolean;
  clientInvited: boolean;
  invitedBy: Actor | null;
  invitedAt: string | null;
  /** The meeting the reply produced, once there is one, so the room links to the calendar. */
  meetingId: string | null;
  openedAt: string;
}

/** How much the writer may add that no checked fact backs.
    strict: nothing; what is left unbacked is taken out before the rep sees it.
    balanced: nothing on purpose; what slips through is marked for the rep.
    open: a sentence or two of its own pitch, each marked for the rep. */
export type Freedom = "strict" | "balanced" | "open";
export const FREEDOMS: Freedom[] = ["strict", "balanced", "open"];

export interface Settings {
  freedom: Freedom;
  /** Who sits in a deal room. Left out of older saved workspaces, so read it as `|| DEFAULT_TEAM`. */
  team?: TeamMember[];
}

export interface Workspace {
  rev: number;
  product: Product | null;
  founder: Founder;
  icp: ICP | null;
  sources: Record<string, Source>;
  leads: Lead[];
  competitors: Competitor[];
  messages: Message[];
  activity: Activity[];
  audit: AuditEntry[];
  credits: Credits;
  run: {
    status: "idle" | "running" | "done" | "error";
    step: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    stats: RunStats;
  };
  graph: { nodes: GNode[]; edges: GEdge[] };
  modes: Modes;
  doNotContact: string[]; // domains
  settings: Settings;
  meetings: Meeting[];
  /** Left out of older saved workspaces, so read it as `|| []`. */
  dealRooms?: DealRoom[];
}

export const COSTS = {
  "discovery.run": 5,
  "lead.enriched": 2,
  "outreach.drafted": 1,
  "radar.scan": 3,
} as const;
