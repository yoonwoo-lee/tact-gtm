// The workspace: everything the app knows, held in memory, saved to .data/workspace.json.
// One instance per server process (kept on globalThis so hot reloads in `next dev` keep it).
import fs from "node:fs";
import path from "node:path";
import { config, modes } from "./config";
import { garbledName } from "./garbled";
import { nextId } from "./ids";
import { Graph } from "./graph";
import { bandPost } from "./providers/band";
import { lastError as billingError, readWallet, trackUsage } from "./providers/billing";
import { hooks } from "./providers/hooks";
import { DEFAULT_TEAM, type Activity, type Actor, type AgentName, type AuditEntry, type LedgerEntry, type RunStats, type Source, type Workspace } from "./types";

export const emptyStats = (): RunStats => ({
  searches: 0,
  sources: 0,
  claimsProposed: 0,
  claimsVerified: 0,
  claimsDropped: 0,
  companiesDropped: 0,
  graphQueries: 0,
  llmCalls: 0,
  replayed: 0,
});

function fresh(): Workspace {
  return {
    rev: 1,
    product: null,
    founder: { name: "", schools: [], employers: [] },
    icp: null,
    sources: {},
    leads: [],
    competitors: [],
    messages: [],
    activity: [],
    audit: [],
    credits: {
      balance: config.startCredits,
      ledger: [],
      flexprice: { configured: modes().billing === "flexprice", accepted: 0, failed: 0, wallet: null, lastError: null },
    },
    run: { status: "idle", step: "", startedAt: null, finishedAt: null, error: null, stats: emptyStats() },
    graph: { nodes: [], edges: [] },
    modes: modes(),
    doNotContact: [],
    settings: { freedom: "balanced", team: DEFAULT_TEAM },
    meetings: [],
    dealRooms: [],
  };
}

export class Store {
  state: Workspace;
  graph = new Graph();
  private seq = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private file = path.join(process.cwd(), config.dataDir, "workspace.json");
  private walletId: string | null = null;
  private lastReading: number | null = null; // the Flexprice wallet, as last read

  constructor() {
    this.state = fresh();
    try {
      if (fs.existsSync(this.file)) {
        const saved = JSON.parse(fs.readFileSync(this.file, "utf8")) as Workspace;
        this.state = { ...fresh(), ...saved, modes: modes() };
        this.state.credits.flexprice.configured = modes().billing === "flexprice";
        if (this.state.run.status === "running") this.state.run.status = "idle"; // the process that ran it is gone
        this.graph.memory.load(saved.graph || { nodes: [], edges: [] });
        this.graph.resync();
        this.seq = this.state.activity.reduce((m, a) => Math.max(m, a.seq), 0);
        this.dropGarbled();
        this.repairIds();
      }
    } catch (e) {
      console.warn("[tact] could not read the saved workspace:", e);
    }
    // What the providers want the person watching to know goes into the feed.
    hooks.notice = (text) => this.log("system", "step", text);
    hooks.replayed = () => {
      this.state.run.stats.replayed = (this.state.run.stats.replayed || 0) + 1;
    };
    void this.refreshWallet();
  }

  /** Two messages must never share an id: an action on one would land on the other ("Already
      decided" on a draft that was never decided). Ids used to be handed out by count, so removing
      a message could cause exactly that. Any message that repeats an earlier id gets a fresh one. */
  private repairIds() {
    const seen = new Set<string>();
    let fixed = 0;
    for (const m of this.state.messages) {
      if (seen.has(m.id)) {
        m.id = nextId("m", this.state.messages);
        fixed += 1;
      }
      seen.add(m.id);
    }
    if (fixed) this.touch();
  }

  /** A saved workspace can hold a "company" read off a page that was not readable (lib/garbled.ts),
      from before such pages were cut out. It is taken out here, with everything hung on it. */
  private dropGarbled() {
    const bad = this.state.leads.filter((l) => garbledName(l.company));
    if (bad.length === 0) return;
    for (const lead of bad) {
      for (const id of [lead.id, ...lead.contacts.map((c) => c.id), ...lead.signals.map((x) => x.id)]) this.graph.removeNode(id);
      this.log("system", "step", `Took out "${lead.company}": it was read off a page whose text could not be read, so it is not a real company name.`);
    }
    const ids = new Set(bad.map((l) => l.id));
    this.state.leads = this.state.leads.filter((l) => !ids.has(l.id));
    this.state.messages = this.state.messages.filter((m) => !ids.has(m.leadId));
    this.state.meetings = (this.state.meetings || []).filter((m) => !ids.has(m.leadId));
    this.touch();
  }

  /** Call after any change, so the page picks it up and it is saved. */
  touch() {
    this.state.rev += 1;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.view()));
      } catch {
        // A read-only disk (a serverless host): the workspace lives for this process only.
      }
    }, 600);
  }

  /** The workspace as the page gets it. */
  view(): Workspace {
    this.state.graph = this.graph.memory.snapshot();
    this.state.modes = { ...modes(), graph: this.graph.engine };
    return this.state;
  }

  reset() {
    const keep = { product: this.state.product, founder: this.state.founder, settings: this.state.settings };
    this.graph.clear();
    this.state = { ...fresh(), ...keep, rev: this.state.rev + 1 };
    this.seq = 0;
    this.touch();
  }

  // ---- what the agents say and do -------------------------------------------------

  log(agent: AgentName, kind: Activity["kind"], text: string, opts: { to?: AgentName; detail?: string } = {}) {
    const entry: Activity = {
      seq: ++this.seq,
      at: new Date().toISOString(),
      agent,
      kind,
      to: opts.to || null,
      text,
      detail: opts.detail || null,
    };
    this.state.activity.push(entry);
    if (this.state.activity.length > 400) this.state.activity.splice(0, this.state.activity.length - 400);
    if (kind === "say" || kind === "flag") void bandPost(agent, text, opts.to || null, false);
    this.touch();
    return entry;
  }

  audit(actor: Actor, action: string, fields: Partial<Omit<AuditEntry, "id" | "at" | "actor" | "action">> = {}) {
    const entry: AuditEntry = {
      id: `au${this.state.audit.length + 1}`,
      at: new Date().toISOString(),
      actor,
      agent: fields.agent ?? null,
      action,
      leadId: fields.leadId ?? null,
      messageId: fields.messageId ?? null,
      from: fields.from ?? null,
      to: fields.to ?? null,
      note: fields.note ?? "",
    };
    this.state.audit.push(entry);
    this.touch();
    return entry;
  }

  addSource(page: { url: string; title: string; text: string; provider: Source["provider"] }): Source {
    const existing = Object.values(this.state.sources).find((s) => s.url === page.url);
    if (existing) {
      if (page.text.length > existing.text.length) existing.text = page.text;
      return existing;
    }
    const id = `s${Object.keys(this.state.sources).length + 1}`;
    const source: Source = { id, ...page, fetchedAt: new Date().toISOString() };
    this.state.sources[id] = source;
    this.state.run.stats.sources += 1;
    return source;
  }

  // ---- credits --------------------------------------------------------------------

  /**
   * The balance the gate uses. It starts from the Flexprice wallet when one can be read and
   * follows it down (see refreshWallet), but it is counted here too, so the gate still works
   * when events are metered in Flexprice without a price that draws the wallet down.
   */
  available(): number {
    return this.state.credits.balance;
  }

  canSpend(credits: number): boolean {
    return this.available() >= credits;
  }

  spend(event: LedgerEntry["event"], credits: number, ref: string) {
    const entry: LedgerEntry = { at: new Date().toISOString(), event, credits: -credits, ref, synced: "local" };
    this.state.credits.balance = Math.round((this.state.credits.balance - credits) * 100) / 100;
    this.state.credits.ledger.push(entry);
    this.touch();
    void trackUsage(event, { credits, ref }, `tact_${Date.now()}_${this.state.credits.ledger.length}`).then((result) => {
      entry.synced = result;
      const fp = this.state.credits.flexprice;
      if (result === "sent") fp.accepted += 1;
      if (result === "failed") {
        fp.failed += 1;
        fp.lastError = billingError;
      }
      this.touch();
    });
  }

  /** `inWallet`: the credits were added to the Flexprice wallet, so the next reading brings them in. */
  topUp(credits: number, inWallet = false) {
    if (!inWallet) this.state.credits.balance += credits;
    this.state.credits.ledger.push({ at: new Date().toISOString(), event: "credits.topup", credits, ref: "rep", synced: "local" });
    this.audit("rep", "Topped up credits", { note: `+${credits}` });
  }

  get flexpriceWalletId() {
    return this.walletId;
  }

  async refreshWallet() {
    if (modes().billing !== "flexprice") return;
    const wallet = await readWallet();
    this.walletId = wallet.id;
    const reading = wallet.balance;
    const c = this.state.credits;
    if (reading != null) {
      if (this.lastReading == null) c.balance = reading; // first reading: the wallet is where we start
      else if (reading > this.lastReading) c.balance += reading - this.lastReading; // topped up
      else if (reading < c.balance) c.balance = reading; // Flexprice has charged more than we counted
      c.balance = Math.round(c.balance * 100) / 100;
      this.lastReading = reading;
    }
    c.flexprice.wallet = reading;
    c.flexprice.lastError = reading == null ? billingError : null;
    this.touch();
  }
}

const holder = globalThis as unknown as { __tactStore?: Store };

export function store(): Store {
  if (!holder.__tactStore) holder.__tactStore = new Store();
  return holder.__tactStore;
}
