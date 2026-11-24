// The run, start to finish, and every action the rep can take afterwards.
// Four agents take part and say what they are doing as they go (the activity feed):
//   planner  - reads the product, decides the plan, sums up
//   builder  - searches, extracts, writes to the graph, drafts messages
//   reviewer - checks every quote and every claim, and stops what it cannot back
//   security - checks what is about to leave: links, addresses, opt-out
import { classifyReply, draftMessage } from "./agents/outreach";
import { noteReplyInDealRoom, openDealRoom } from "./dealroom";
import { findAccounts, findCompetitors, findPeople, type StepReport } from "./agents/discover";
import { inferIcp } from "./agents/icp";
import { whyNobody, widerQueries, type Search2 } from "./agents/widen";
import { config } from "./config";
import { QUERY_MEANING, type QueryName } from "./graph/cypher";
import type { Rows } from "./graph";
import { companyId, nextId, schoolId } from "./ids";
import { enrichDomain, guessEmail } from "./providers/enrich";
import { topUpWallet } from "./providers/billing";
import { bestContact, scoreLead, strongestSignal } from "./score";
import { emptyStats, store, type Store } from "./store";
import { greet, located, without } from "./marks";
import { fromStamp, wantsMeeting, whenFrom } from "./meetings";
import { findJobs, watchTitles } from "./agents/radar";
import { COSTS, FREEDOMS, STAGE_NAMES, type Evidence, type Founder, type Freedom, type Lead, type Meeting, type Product, type Stage, type WarmPath } from "./types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : /(s|ch|sh|x)$/.test(word) ? "es" : "s"}`;

async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(work));
}

function reportLine(s: Store, what: string, r: StepReport) {
  if (r.proposed === 0) return;
  const dropped = r.dropped.length;
  s.log(
    "reviewer",
    dropped ? "flag" : "step",
    `${what}: checked ${plural(r.proposed, "quote")} against the pages. ${r.verified} found word for word${dropped ? `, ${dropped} not found and dropped` : ""}.`,
    dropped ? { detail: `Dropped because the quote is not on the cited page:\n- ${r.dropped.join("\n- ")}` } : {},
  );
}

function setUpGraph(s: Store, product: Product, founder: Founder) {
  const g = s.graph;
  g.upsertNode("Product", "product", product.name, { url: product.url });
  g.upsertNode("Person", "founder", founder.name || "Founder", { isFounder: true, title: "Founder" });
  for (const school of founder.schools) {
    g.upsertNode("School", schoolId(school), school, {});
    g.upsertEdge("STUDIED_AT", "founder", schoolId(school), {});
  }
  for (const employer of founder.employers) {
    if (!g.memory.nodes.has(companyId(employer))) g.upsertNode("Company", companyId(employer), employer, { isTarget: false });
    g.upsertEdge("PREVIOUSLY_EMPLOYED_AT", "founder", companyId(employer), {});
  }
}

async function ask<K extends QueryName>(s: Store, name: K): Promise<Rows[K][]> {
  const result = await s.graph.query(name);
  s.state.run.stats.graphQueries += 1;
  s.spend("graph.query", 0, name);
  s.log("builder", "query", `Graph: ${QUERY_MEANING[name].toLowerCase()}. ${plural(result.rows.length, "row")} in ${result.ms} ms (${result.engine === "neo4j" ? "Neo4j" : "embedded graph"}).`, {
    detail: result.cypher || `(embedded graph) ${QUERY_MEANING[name]}`,
  });
  return result.rows;
}

/** Ask the graph the multi-hop questions, then score every lead. */
export async function reason(s: Store) {
  const founder = s.state.founder.name || "the founder";
  const memory = s.graph.memory;

  const paths = await ask(s, "warmPaths");
  for (const lead of s.state.leads) lead.warmPaths = lead.warmPaths.filter((w) => w.kind === "referral");
  for (const row of paths) {
    const lead = s.state.leads.find((l) => l.id === row.companyId);
    const contact = lead?.contacts.find((c) => c.id === row.personId);
    if (!lead || !contact) continue;
    const edge = memory.edges.get(`${row.personId}|${row.personEdge}|${row.hubId}`);
    const evidence: Evidence | null = edge?.props.quote && edge.props.sourceId ? { sourceId: String(edge.props.sourceId), quote: String(edge.props.quote), verified: true } : null;
    const school = row.hubLabel === "School";
    const path: WarmPath = {
      kind: school ? "shared_school" : "shared_employer",
      contactId: contact.id,
      via: row.hubName,
      viaId: row.hubId,
      hops: ["founder", row.hubId, contact.id, lead.id],
      note: school ? `${contact.name} studied at ${row.hubName}, and so did ${founder}.` : `${contact.name} worked at ${row.hubName}, and so did ${founder}.`,
      evidence,
    };
    if (!lead.warmPaths.some((w) => w.contactId === path.contactId && w.viaId === path.viaId)) lead.warmPaths.unshift(path);
  }
  await ask(s, "displacement");
  await ask(s, "signals");

  for (const lead of s.state.leads) rescore(s, lead);
  s.touch();
}

function rescore(s: Store, lead: Lead) {
  lead.score = scoreLead(lead, s.state.icp);
  const top = strongestSignal(lead.signals);
  lead.whyNow = top ? top.summary : null;
  const blocked = lead.domain && s.state.doNotContact.includes(lead.domain);
  lead.status = lead.negative || blocked ? "suppressed" : lead.signals.length === 0 && lead.warmPaths.length === 0 ? "held" : "active";
  s.graph.upsertEdge("MATCHED_TO", lead.id, "product", { score: lead.score.total, tier: lead.score.tier });
}

function sortLeads(s: Store) {
  const order = { active: 0, held: 1, suppressed: 2 };
  s.state.leads.sort((a, b) => order[a.status] - order[b.status] || b.score.total - a.score.total);
}

export async function runPipeline(product: Product, founder: Founder) {
  const s = store();
  if (s.state.run.status === "running") throw new Error("A run is already in progress");
  if (!s.canSpend(COSTS["discovery.run"])) throw new Error(`Out of credits: a search costs ${COSTS["discovery.run"]}. Top up to continue.`);

  const credits = s.state.credits;
  const keepDnc = s.state.doNotContact;
  s.state.product = product;
  s.state.founder = founder;
  s.reset();
  s.state.credits = credits;
  s.state.doNotContact = keepDnc;
  s.state.run = { status: "running", step: "Reading the product", startedAt: new Date().toISOString(), finishedAt: null, error: null, stats: emptyStats() };
  s.touch();

  try {
    s.spend("discovery.run", COSTS["discovery.run"], product.name);
    setUpGraph(s, product, founder);
    s.log("planner", "say", `New brief: ${product.name}. Plan: define who buys it, find real accounts with proof, map their people and buying signals, look for a warm way in, and draft only where there is a reason to write.`, { to: "builder" });

    // 1. Who buys this?
    s.state.run.stats.llmCalls += 1;
    const icp = await inferIcp(product, founder);
    s.state.icp = icp;
    s.log("planner", "step", `Ideal customer: ${icp.industries.map((i) => i.name).join(", ")}. Buyers: ${icp.personas.map((p) => p.title).join(", ")}. I also see ${plural(icp.expansions.length, "adjacent segment")} for the founder to accept or dismiss.`);
    s.log("planner", "say", `Search each segment for named accounts. Keep only what you can quote from the page.`, { to: "builder" });

    // 2. Accounts, with proof.
    s.state.run.step = "Finding accounts";
    s.touch();
    const accountPlan = icp.searchPlan.filter((q) => q.purpose === "accounts").slice(0, 5);
    const totals: StepReport = { proposed: 0, verified: 0, dropped: [], leads: [] };
    // What happened in this step, so that a run that finds nobody can say why.
    const seen: Search2 = { searches: 0, searchErrors: [], modelErrors: [], pages: 0, named: 0, proposed: 0, verified: 0 };
    const searchFor = (plan: { query: string; segment: string }[], pages: number) =>
      inBatches(plan, 3, async (item) => {
        s.log("builder", "step", `Searching: ${item.query}`);
        seen.searches += 1;
        try {
          const r = await findAccounts(s, item.query, item.segment, null, pages);
          totals.proposed += r.proposed;
          totals.verified += r.verified;
          totals.dropped.push(...r.dropped);
          seen.pages += r.pages || 0;
          seen.named += r.named || 0;
          if (r.searchError) seen.searchErrors.push(r.searchError);
        } catch (e) {
          seen.modelErrors.push((e as Error).message);
          s.log("builder", "error", `Could not read the results for "${item.query}": ${(e as Error).message}`);
        }
      });
    await searchFor(accountPlan, 5);
    // Too few? Search again, wider: news of growth and job posts in each segment, more pages each.
    // Not when the search itself is what failed: more of the same would only fail again.
    if (s.state.leads.length < 3 && seen.searchErrors.length < seen.searches) {
      const wider = widerQueries(icp, accountPlan.map((q) => q.query));
      if (wider.length) {
        s.log("planner", "say", `Only ${plural(s.state.leads.length, "account")} so far. Search wider: news of growth and job posts in each segment.`, { to: "builder" });
        s.state.run.step = "Searching wider";
        s.touch();
        await searchFor(wider, 8);
      }
    }
    seen.proposed = totals.proposed;
    seen.verified = totals.verified;
    s.log("builder", "say", `Found ${plural(s.state.leads.length, "account")} across ${plural(seen.searches, "search")}. Please check my quotes.`, { to: "reviewer" });
    reportLine(s, "Accounts", totals);
    if (s.state.leads.length > config.maxCompanies) {
      for (const lead of s.state.leads) rescore(s, lead);
      sortLeads(s);
      for (const extra of s.state.leads.splice(config.maxCompanies)) s.graph.removeNode(extra.id);
    }
    if (s.state.leads.length === 0) throw new Error(whyNobody(seen));

    // 3. Why now: one more search per account for fresh signals.
    s.state.run.step = "Looking for buying signals";
    s.touch();
    const signalTotals: StepReport = { proposed: 0, verified: 0, dropped: [], leads: [] };
    const triggerWords = "hiring OR funding OR launch OR expansion OR announces";
    await inBatches(s.state.leads.filter((l) => !l.negative), 4, async (lead) => {
      try {
        const r = await findAccounts(s, `"${lead.company}" ${triggerWords}`, lead.segment, lead.company);
        signalTotals.proposed += r.proposed;
        signalTotals.verified += r.verified;
        signalTotals.dropped.push(...r.dropped);
      } catch (e) {
        s.log("builder", "error", `Signals for ${lead.company}: ${(e as Error).message}`);
      }
    });
    reportLine(s, "Buying signals", signalTotals);

    // 3b. The Hiring Radar: postings first, and each one that holds up is a hiring signal.
    const radarTitles = watchTitles(s.state.icp);
    if (radarTitles.length > 0) {
      s.state.run.step = "Watching job postings";
      s.touch();
      s.log("builder", "say", `Watching job boards for ${plural(radarTitles.length, "role")} the plan names: ${radarTitles.join(", ")}. A posting is a buying signal with a date on it.`, { to: "planner" });
      try {
        const radar = await findJobs(s);
        reportLine(s, "Job postings", radar);
        if (radar.postings.length > 0) {
          const firsts = radar.postings.filter((j) => j.firstHire).length;
          s.log("builder", "say", `${plural(radar.postings.length, "posting")} held up${firsts ? `, ${firsts} of them a first hire for that function` : ""}.`, { to: "planner" });
        }
        for (const lead of s.state.leads) rescore(s, lead);
      } catch (e) {
        s.log("builder", "error", `Hiring Radar: ${(e as Error).message}`);
      }
    }

    // 4. People, and a warm way in.
    s.state.run.step = "Finding the people";
    s.touch();
    for (const lead of s.state.leads) rescore(s, lead);
    sortLeads(s);
    const worth = s.state.leads.filter((l) => !l.negative).slice(0, 6);
    const peopleTotals: StepReport = { proposed: 0, verified: 0, dropped: [], leads: [] };
    await inBatches(worth, 3, async (lead) => {
      try {
        const r = await findPeople(s, lead);
        peopleTotals.proposed += r.proposed;
        peopleTotals.verified += r.verified;
        peopleTotals.dropped.push(...r.dropped);
      } catch (e) {
        s.log("builder", "error", `People at ${lead.company}: ${(e as Error).message}`);
      }
    });
    const anchors = [...founder.schools, ...founder.employers].slice(0, 2);
    if (anchors.length) {
      s.state.run.step = "Looking for a warm way in";
      s.log("builder", "step", `Looking for people who share ${anchors.join(" or ")} with ${founder.name || "the founder"}.`);
      const pairs = worth.slice(0, anchors.length > 1 ? 4 : 6).flatMap((lead) => anchors.map((anchor) => ({ lead, anchor })));
      await inBatches(pairs, 4, async ({ lead, anchor }) => {
        try {
          const r = await findPeople(s, lead, anchor);
          peopleTotals.proposed += r.proposed;
          peopleTotals.verified += r.verified;
          peopleTotals.dropped.push(...r.dropped);
        } catch (e) {
          s.log("builder", "error", `Warm path at ${lead.company}: ${(e as Error).message}`);
        }
      });
    }
    reportLine(s, "People", peopleTotals);

    // Competitors.
    s.state.run.step = "Mapping competitors";
    s.touch();
    const compTotals: StepReport = { proposed: 0, verified: 0, dropped: [], leads: [] };
    for (const item of icp.searchPlan.filter((q) => q.purpose === "competitors").slice(0, 2)) {
      try {
        const r = await findCompetitors(s, item.query);
        compTotals.proposed += r.proposed;
        compTotals.verified += r.verified;
        compTotals.dropped.push(...r.dropped);
      } catch (e) {
        s.log("builder", "error", `Competitors: ${(e as Error).message}`);
      }
    }
    reportLine(s, "Competitors", compTotals);

    // 5. Ask the graph, then score.
    s.state.run.step = "Reasoning over the graph";
    s.touch();
    await reason(s);
    sortLeads(s);

    const active = s.state.leads.filter((l) => l.status === "active");
    const held = s.state.leads.filter((l) => l.status === "held");
    const suppressed = s.state.leads.filter((l) => l.status === "suppressed");
    const warm = s.state.leads.filter((l) => l.warmPaths.length > 0);
    s.log(
      "planner",
      "say",
      `${plural(s.state.leads.length, "account")} scored. ${active.length} have a reason to write now${warm.length ? `, ${warm.length} with a warm way in` : ""}. Holding ${held.length} with no signal yet${suppressed.length ? ` and leaving out ${suppressed.length} that show a bad fit (${suppressed.map((l) => l.negative?.signal || "do not contact").join("; ")})` : ""}. Draft the top ${Math.min(config.maxDrafts, active.length)}.`,
      { to: "builder" },
    );

    // 6. Enrich the best, then draft. Both are metered, so both stop when credits run out.
    s.state.run.step = "Finding emails and drafting";
    s.touch();
    const top = active.slice(0, config.maxDrafts);
    for (const lead of top.filter((l) => l.score.tier === "A" && l.domain).slice(0, 3)) {
      try {
        await enrichLead(lead.id, "agent");
      } catch (e) {
        s.log("builder", "flag", (e as Error).message);
        break;
      }
    }
    for (const lead of top) {
      try {
        await draftLead(lead.id, "agent");
      } catch (e) {
        s.log("builder", "flag", (e as Error).message);
        if (/credits/i.test((e as Error).message)) break;
      }
    }

    const drafts = s.state.messages.filter((m) => m.status === "draft").length;
    const st = s.state.run.stats;
    if (s.state.modes.llm !== "sample" || s.state.modes.search !== "sample") {
      s.log("system", "step", `This run asked the model ${plural(st.llmCalls, "time")} and searched ${plural(st.searches, "time")}${st.replayed ? `. ${st.replayed} of those were answered from saved copies on this machine, not the network` : ""}.`);
    }
    s.log("planner", "say", `Done. ${plural(drafts, "message")} waiting for your approval. Nothing is sent until you approve it.`, { to: "rep" });
    s.state.run.status = "done";
    s.state.run.step = "Done";
  } catch (e) {
    s.state.run.status = "error";
    s.state.run.error = (e as Error).message;
    s.log("system", "error", (e as Error).message);
  } finally {
    s.state.run.finishedAt = new Date().toISOString();
    s.touch();
    void s.refreshWallet();
  }
}

// ---- what the rep (or the agent, during a run) can do afterwards ----------------------

/**
 * Watch mode. Runs only the Radar on the plan already in hand, adds only postings that are not
 * in the graph yet, then scores and drafts whatever is new so it lands in the Approve queue.
 * Metered on its own as radar.scan, and blocked when the credits run out.
 */
export async function scanJobs() {
  const s = store();
  if (!s.state.icp) throw new Error("Describe the product first: the Radar watches the roles the plan names.");
  const titles = watchTitles(s.state.icp);
  if (titles.length === 0) throw new Error("The plan names no roles to watch yet.");
  if (!s.canSpend(COSTS["radar.scan"])) throw new Error(`Out of credits: a scan costs ${COSTS["radar.scan"]}. Top up to continue.`);
  s.spend("radar.scan", COSTS["radar.scan"], `Radar: ${titles.length} roles`);

  s.log("rep", "step", "Scan for new job posts");
  s.log("builder", "say", `Scanning for ${plural(titles.length, "role")}: ${titles.join(", ")}.`, { to: "planner" });
  const before = new Set(s.state.leads.map((l) => l.id));
  const r = await findJobs(s);
  reportLine(s, "Job postings", r);

  if (r.postings.length === 0) {
    s.log("builder", "say", `Nothing new. ${r.known ? `${plural(r.known, "posting")} already on the board.` : "No posting on those roles held up."}`, { to: "rep" });
    s.touch();
    return { postings: 0, known: r.known, leads: 0, drafted: 0 };
  }

  for (const lead of s.state.leads) rescore(s, lead);
  await reason(s);
  sortLeads(s);

  const fresh = r.leads.filter((l) => !before.has(l.id));
  const firsts = r.postings.filter((j) => j.firstHire).length;
  s.log(
    "builder",
    "say",
    `${plural(r.postings.length, "new posting")}${firsts ? `, ${firsts} a first hire for that function` : ""}${fresh.length ? `, ${plural(fresh.length, "new account")}` : ""}. Drafting where there is a reason to write.`,
    { to: "planner" },
  );

  let drafted = 0;
  for (const lead of r.leads.filter((l) => l.status === "active")) {
    try {
      await draftLead(lead.id, "agent");
      drafted += 1;
    } catch (e) {
      s.log("builder", "flag", (e as Error).message);
      if (/credits/i.test((e as Error).message)) break;
    }
  }
  s.log("planner", "say", `${plural(drafted, "message")} waiting for your approval. Nothing is sent until you approve it.`, { to: "rep" });
  s.touch();
  void s.refreshWallet();
  return { postings: r.postings.length, known: r.known, leads: fresh.length, drafted };
}

function leadOrThrow(s: Store, id: string): Lead {
  const lead = s.state.leads.find((l) => l.id === id);
  if (!lead) throw new Error("No such lead");
  return lead;
}

export async function enrichLead(leadId: string, by: "agent" | "rep" = "rep") {
  const s = store();
  const lead = leadOrThrow(s, leadId);
  if (!lead.domain) throw new Error(`${lead.company}: no website found in the sources. Add the website, then look for emails.`);
  if (!s.canSpend(COSTS["lead.enriched"])) throw new Error(`Out of credits: enriching ${lead.company} costs ${COSTS["lead.enriched"]}. Top up to continue.`);
  s.spend("lead.enriched", COSTS["lead.enriched"], lead.company);
  s.log("builder", "step", `Looking up the people and email addresses at ${lead.company} (${lead.domain}).`);
  const result = await enrichDomain(lead.domain);
  const source = s.addSource({ url: `https://${lead.domain}`, title: `${lead.company}: contact records (${result.provider})`, text: `${result.emails.length} addresses on ${lead.domain}. Pattern: ${result.pattern || "unknown"}.`, provider: result.provider });
  let verified = 0;
  let unverified = 0;
  for (const found of result.emails) {
    const full = `${found.firstName} ${found.lastName}`.trim().toLowerCase();
    let contact = lead.contacts.find((c) => c.name.toLowerCase() === full);
    if (!contact && found.firstName && found.lastName && /chief|head|director|vp|vice|owner|founder|president/i.test(found.position)) {
      // Someone the search did not turn up, in a senior role: add them, with the record as proof.
      const name = `${found.firstName} ${found.lastName}`;
      contact = { id: `p:${full.replace(/\s+/g, "-")}:${lead.id.slice(3)}`, name, title: found.position, seniority: found.seniority, linkedin: found.linkedin, email: null, emailStatus: null, emailConfidence: null, emailSource: null, evidence: [] };
      lead.contacts.push(contact);
      s.graph.upsertNode("Person", contact.id, name, { title: found.position });
      s.graph.upsertEdge("WORKS_AT", contact.id, lead.id, { title: found.position });
    }
    if (!contact) continue;
    contact.email = found.email;
    contact.emailStatus = found.status;
    contact.emailConfidence = found.confidence;
    contact.emailSource = source.id;
    contact.linkedin = contact.linkedin || found.linkedin;
    if (found.status === "verified") verified += 1;
    else unverified += 1;
  }
  let guessed = 0;
  for (const contact of lead.contacts.filter((c) => !c.email)) {
    const [first, ...rest] = contact.name.split(" ");
    const guess = guessEmail(result.pattern, first, rest.slice(-1)[0] || "", lead.domain);
    if (!guess) continue;
    contact.email = guess;
    contact.emailStatus = "guess";
    contact.emailConfidence = null;
    contact.emailSource = source.id;
    guessed += 1;
  }
  lead.enriched = true;
  for (const m of s.state.messages.filter((x) => x.leadId === lead.id && x.status === "draft")) {
    let c = lead.contacts.find((x) => x.id === m.contactId);
    if (!c && !m.contactId) {
      // The draft was written to nobody in particular, and now there is somebody: address it to them.
      c = bestContact(lead, s.state.icp) || undefined;
      if (c) {
        m.contactId = c.id;
        m.to = `${c.name}, ${c.title}`;
        m.body = greet(m.body, c.name);
      }
    }
    if (c?.email) m.toEmail = c.email;
  }
  rescore(s, lead);
  const parts = [verified ? plural(verified, "verified address") : "", unverified ? `${unverified} found but not verified` : "", guessed ? `${guessed} guessed from the pattern and marked as a guess` : ""].filter(Boolean);
  s.log("builder", "step", `${lead.company}: ${parts.length ? parts.join(", ") : "no address found for the people we know"}.`);
  s.audit(by, "Looked up email addresses", { agent: by === "agent" ? "builder" : null, leadId: lead.id, note: `${verified} verified, ${unverified} unverified, ${guessed} guessed` });
  s.touch();
}

export async function draftLead(leadId: string, by: "agent" | "rep" = "rep", force = false) {
  const s = store();
  const lead = leadOrThrow(s, leadId);
  if (lead.status === "suppressed") throw new Error(`${lead.company} is left out (${lead.negative?.signal || "do not contact"}). No message will be drafted.`);
  if (lead.status === "held" && !force) throw new Error(`${lead.company}: no reason to write yet. ${config.appName} holds accounts with no buying signal.`);
  if (!s.canSpend(COSTS["outreach.drafted"])) throw new Error(`Out of credits: a draft costs ${COSTS["outreach.drafted"]}. Top up to continue.`);
  s.spend("outreach.drafted", COSTS["outreach.drafted"], lead.company);
  if (by === "rep" && lead.status === "held") s.audit("rep", "Asked for a draft with no signal", { leadId: lead.id });
  return draftMessage(s, lead);
}

export function decideMessage(messageId: string, action: "approve" | "reject" | "edit", edits?: { subject?: string; body?: string }) {
  const s = store();
  const message = s.state.messages.find((m) => m.id === messageId);
  if (!message) throw new Error("No such message");
  const lead = leadOrThrow(s, message.leadId);
  if (action === "edit") {
    if (message.status !== "draft") throw new Error("Only a draft can be edited");
    if (edits?.subject != null) message.subject = edits.subject;
    if (edits?.body != null) message.body = edits.body;
    message.editedByRep = true;
    s.audit("rep", "Edited a draft", { leadId: lead.id, messageId });
  } else if (action === "reject") {
    message.status = "rejected";
    message.decidedAt = new Date().toISOString();
    s.audit("rep", "Rejected a draft", { leadId: lead.id, messageId });
  } else {
    if (message.status !== "draft") throw new Error("Already decided");
    // A message with nobody to send it to cannot be approved for sending.
    if (!message.toEmail) throw new Error("There is no address for this message yet. Find one or type one in, then approve.");
    message.status = "sent";
    message.decidedAt = new Date().toISOString();
    // Sending is simulated: the message is recorded as sent and nothing leaves this machine.
    s.spend("outreach.sent", 0, lead.company);
    if (message.contactId) s.graph.upsertEdge("CONTACTED_VIA", "product", message.contactId, { channel: "email", at: message.decidedAt, messageId });
    s.audit("rep", "Approved and sent", { leadId: lead.id, messageId, note: `To ${message.to}${message.editedByRep ? " (edited by the rep)" : ""}. Sending is simulated.` });
    if (lead.stage === "matched") setStage(s, lead, "contacted", "rep", "Message approved");
    // The team gets a room for this deal. It opens once per lead, and a failure here must never
    // be the reason an approved send is not recorded.
    try {
      openDealRoom(lead.id);
    } catch (e) {
      s.log("system", "step", `The deal room could not be opened: ${e instanceof Error ? e.message : String(e)}. The send is recorded.`);
    }
  }
  s.touch();
}

/** The rep types in the address a message should go to, when the lookup has none. */
export function setAddress(messageId: string, email: string) {
  const s = store();
  const message = s.state.messages.find((m) => m.id === messageId);
  if (!message) throw new Error("No such message");
  if (message.status !== "draft") throw new Error("Only a draft can be changed");
  const address = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) throw new Error("That does not look like an email address.");
  const lead = leadOrThrow(s, message.leadId);
  if (s.state.doNotContact.some((d) => address.toLowerCase().endsWith(`@${d}`) || address.toLowerCase().endsWith(`.${d}`))) throw new Error("That address is at a domain that asked not to be contacted.");
  message.toEmail = address;
  const contact = lead.contacts.find((c) => c.id === message.contactId);
  if (contact && !contact.email) {
    contact.email = address;
    contact.emailStatus = "unverified";
    contact.emailConfidence = null;
  }
  s.audit("rep", "Typed in an address", { leadId: lead.id, messageId, note: address });
  s.touch();
}

/** The rep deals with one unbacked claim: delete its sentence, keep it, or take the keep back. */
export function decideClaim(messageId: string, index: number | "all", action: "delete" | "keep" | "unkeep") {
  const s = store();
  const message = s.state.messages.find((m) => m.id === messageId);
  if (!message) throw new Error("No such message");
  if (message.status !== "draft") throw new Error("Only a draft can be changed");
  const lead = leadOrThrow(s, message.leadId);
  if (index === "all") {
    // Every claim still marked in the message, in one go.
    if (action !== "delete") throw new Error("Only delete works on all of them at once");
    const open = message.claims.filter((c) => !c.supported && !c.kept && !c.removed && located(message.subject, message.body, c.text));
    if (open.length === 0) throw new Error("Nothing is marked in this message");
    const next = without(message.subject, message.body, open.map((c) => c.text), `${s.state.product?.name || "A note"} for ${lead.company}`);
    message.subject = next.subject;
    message.body = next.body;
    message.editedByRep = true;
    for (const c of open) c.removed = true;
    s.audit("rep", "Deleted every unbacked sentence", { leadId: lead.id, messageId, note: plural(open.length, "sentence") });
    s.touch();
    return;
  }
  const claim = message.claims[index];
  if (!claim || claim.supported) throw new Error("No such claim");
  const quote = claim.text.length > 90 ? `${claim.text.slice(0, 87)}...` : claim.text;
  if (action === "delete") {
    const before = { subject: message.subject, body: message.body };
    // Not in the message as it stands (the reviewer paraphrased, or it was edited out): nothing
    // to take out, and above all the subject is not to be swapped for a plain one.
    const there = located(message.subject, message.body, claim.text);
    const next = there ? without(message.subject, message.body, [claim.text], `${s.state.product?.name || "A note"} for ${lead.company}`) : before;
    message.subject = next.subject;
    message.body = next.body;
    if (there) message.editedByRep = true;
    claim.kept = false;
    claim.removed = true;
    const changed = next.subject !== before.subject || next.body !== before.body;
    s.audit("rep", changed ? "Deleted an unbacked sentence" : "Dismissed a claim that is not in the message", { leadId: lead.id, messageId, note: quote });
  } else {
    claim.kept = action === "keep";
    s.audit("rep", claim.kept ? "Kept a sentence nothing backs" : "Marked a sentence as unbacked again", { leadId: lead.id, messageId, note: quote });
  }
  s.touch();
}

/** How much the writer may add on its own. It applies to drafts written from now on. */
export function setFreedom(freedom: Freedom) {
  const s = store();
  if (!FREEDOMS.includes(freedom)) throw new Error("Unknown setting");
  if (s.state.settings?.freedom === freedom) return;
  s.state.settings = { ...s.state.settings, freedom };
  s.audit("rep", "Changed how much the AI may add", { note: freedom === "strict" ? "Facts only" : freedom === "open" ? "Its own pitch, marked" : "Balanced" });
  s.touch();
}

function setStage(s: Store, lead: Lead, stage: Stage, by: "agent" | "rep", note: string) {
  const from = lead.stage;
  if (from === stage) return;
  lead.stage = stage;
  lead.stageBy = by;
  lead.stageAt = new Date().toISOString();
  s.audit(by, `Moved to ${STAGE_NAMES[stage]}`, { agent: by === "agent" ? "planner" : null, leadId: lead.id, from, to: stage, note });
  s.graph.upsertEdge("MATCHED_TO", lead.id, "product", { stage });
}

export function moveStage(leadId: string, stage: Stage) {
  const s = store();
  setStage(s, leadOrThrow(s, leadId), stage, "rep", "Moved by the rep");
  s.touch();
}

/** The rep pastes a reply. The agent reads it, moves the lead, and looks for a referral path. */
export async function logReply(leadId: string, text: string) {
  const s = store();
  const lead = leadOrThrow(s, leadId);
  const sent = [...s.state.messages].reverse().find((m) => m.leadId === leadId && m.status === "sent");
  const result = await classifyReply(s, text);
  if (sent?.contactId) s.graph.upsertEdge("REPLIED_TO", sent.contactId, "product", { intent: result.intent, at: new Date().toISOString() });
  s.log("planner", "step", `Reply from ${lead.company}: ${result.summary} Next: ${result.next_step}`);
  if (result.intent === "unsubscribe") {
    if (lead.domain && !s.state.doNotContact.includes(lead.domain)) s.state.doNotContact.push(lead.domain);
    setStage(s, lead, "lost", "agent", "Asked not to be contacted: added to do-not-contact");
    rescore(s, lead);
  } else if (result.intent === "negative") {
    setStage(s, lead, "lost", "agent", result.summary);
  } else {
    setStage(s, lead, "replied", "agent", result.summary);
  }

  // A reply opens new doors: former colleagues of this person at other target accounts.
  if (result.intent === "positive" || result.intent === "neutral") {
    const rows = await s.graph.query("referralPaths");
    s.state.run.stats.graphQueries += 1;
    s.spend("graph.query", 0, "referralPaths");
    s.log("builder", "query", `Graph: ${QUERY_MEANING.referralPaths.toLowerCase()}. ${plural(rows.rows.length, "row")} (${rows.engine === "neo4j" ? "Neo4j" : "embedded graph"}).`, { detail: rows.cypher || `(embedded graph) ${QUERY_MEANING.referralPaths}` });
    for (const row of rows.rows) {
      const target = s.state.leads.find((l) => l.id === row.companyId);
      const to = target?.contacts.find((c) => c.id === row.toPersonId);
      const from = s.state.leads.flatMap((l) => l.contacts).find((c) => c.id === row.fromPersonId);
      if (!target || !to || !from) continue;
      if (target.warmPaths.some((w) => w.kind === "referral" && w.contactId === to.id && w.viaId === from.id)) continue;
      target.warmPaths.push({
        kind: "referral",
        contactId: to.id,
        via: from.name,
        viaId: from.id,
        hops: [from.id, row.hubId, to.id, target.id],
        note: `${from.name} just replied, and used to work with ${to.name} at ${row.hubName}. Ask for an introduction.`,
        evidence: null,
      });
      rescore(s, target);
      s.log("planner", "say", `New way in: ${from.name} replied and used to work with ${to.name} (${target.company}) at ${row.hubName}. Ask ${from.name.split(" ")[0]} for an introduction before writing cold.`, { to: "rep" });
    }
  }
  // They agreed to talk: put it on the calendar as a proposal. Only the rep books it.
  if (result.intent === "positive" && wantsMeeting(text) && !(s.state.meetings || []).some((m) => m.leadId === lead.id && m.status !== "cancelled")) {
    const contact = lead.contacts.find((c) => c.id === sent?.contactId) || lead.contacts[0] || null;
    const when = whenFrom(text, new Date());
    const meeting: Meeting = {
      id: nextId("mt", s.state.meetings || []),
      leadId: lead.id,
      contactId: contact?.id || null,
      title: `${s.state.product?.name || "Intro"} intro: ${contact ? `${contact.name}, ` : ""}${lead.company}`,
      start: when.start,
      minutes: 30,
      status: "proposed",
      exact: when.exact,
      note: [`With ${contact ? `${contact.name}, ${contact.title}, ` : ""}${lead.company}.`, contact?.email ? `Their address: ${contact.email}` : "", `Their reply: "${text.trim().slice(0, 400)}"`].filter(Boolean).join("\n"),
      createdAt: new Date().toISOString(),
    };
    s.state.meetings = [...(s.state.meetings || []), meeting];
    s.audit("agent", "Proposed a meeting", { agent: "planner", leadId: lead.id, note: `${sayWhen(when.start)}${when.exact ? "" : " (a suggestion: the reply named no exact time)"}` });
    s.log("planner", "say", `${contact?.name || lead.company} agreed to talk. I put ${sayWhen(when.start)} on the calendar as a proposal${when.exact ? ", the time they named" : ": they named no exact time, so change it if needed"}. Confirm it under Pipeline.`, { to: "rep" });
  }
  // The team's room hears the reply last, so it can link the meeting the reply just produced.
  try {
    noteReplyInDealRoom(lead.id, result);
  } catch (e) {
    s.log("system", "step", `The deal room could not be updated: ${e instanceof Error ? e.message : String(e)}.`);
  }
  sortLeads(s);
  s.touch();
  return result;
}

const sayWhen = (start: string) => fromStamp(start).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The rep books a proposed meeting (perhaps at another time), moves a booked one, or drops it. */
export function decideMeeting(meetingId: string, action: "book" | "cancel", start?: string, minutes?: number) {
  const s = store();
  const meeting = (s.state.meetings || []).find((m) => m.id === meetingId);
  if (!meeting) throw new Error("No such meeting");
  const lead = leadOrThrow(s, meeting.leadId);
  if (action === "cancel") {
    meeting.status = "cancelled";
    s.audit("rep", "Took a meeting off the calendar", { leadId: lead.id, note: sayWhen(meeting.start) });
  } else {
    if (start) {
      if (Number.isNaN(fromStamp(start).getTime())) throw new Error("Pick a day and a time");
      meeting.start = start.slice(0, 16);
      meeting.exact = true;
    }
    if (minutes && minutes >= 10 && minutes <= 240) meeting.minutes = Math.round(minutes);
    const moved = meeting.status === "booked";
    meeting.status = "booked";
    s.audit("rep", moved ? "Moved a meeting" : "Booked a meeting", { leadId: lead.id, note: `${sayWhen(meeting.start)}, ${meeting.minutes} min` });
    if (lead.stage === "matched" || lead.stage === "contacted" || lead.stage === "replied") setStage(s, lead, "meeting", "rep", `Meeting booked for ${sayWhen(meeting.start)}`);
  }
  s.touch();
}

export function setDomain(leadId: string, domain: string) {
  const s = store();
  const lead = leadOrThrow(s, leadId);
  const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean)) throw new Error("That does not look like a domain (example: acme.com)");
  lead.domain = clean;
  s.graph.upsertNode("Company", lead.id, lead.company, { domain: clean });
  s.audit("rep", "Set the website", { leadId, note: clean });
  rescore(s, lead);
  s.touch();
}

/** Accept or dismiss an adjacent segment. Accepting searches it right away. */
export async function decideExpansion(id: string, action: "accept" | "dismiss", segment?: string) {
  const s = store();
  const x = s.state.icp?.expansions.find((e) => e.id === id);
  if (!x) throw new Error("No such suggestion");
  if (action === "dismiss") {
    x.status = "dismissed";
    s.audit("rep", "Dismissed a suggested segment", { note: x.segment });
    s.touch();
    return;
  }
  if (segment && segment.trim()) x.segment = segment.trim();
  x.status = "accepted";
  s.audit("rep", "Accepted a suggested segment", { note: x.segment });
  s.log("planner", "say", `The founder accepted "${x.segment}". Search it and score what you find.`, { to: "builder" });
  s.touch();
  const before = s.state.leads.length;
  const r = await findAccounts(s, `${x.segment} organisations news`, x.segment);
  reportLine(s, x.segment, r);
  for (const lead of r.leads) {
    try {
      await findPeople(s, lead);
    } catch {
      // people are optional here
    }
  }
  await reason(s);
  sortLeads(s);
  s.log("builder", "say", `"${x.segment}": ${plural(s.state.leads.length - before, "new account")}.`, { to: "rep" });
  s.touch();
}

export async function topUp(credits: number) {
  const s = store();
  const inWallet = s.flexpriceWalletId ? await topUpWallet(s.flexpriceWalletId, credits) : false;
  s.topUp(credits, inWallet);
  await s.refreshWallet();
  s.touch();
}

export function suppress(leadId: string) {
  const s = store();
  const lead = leadOrThrow(s, leadId);
  if (lead.domain && !s.state.doNotContact.includes(lead.domain)) s.state.doNotContact.push(lead.domain);
  lead.negative = lead.negative || { signal: "Marked do-not-contact by the rep", evidence: null };
  rescore(s, lead);
  s.audit("rep", "Marked do-not-contact", { leadId });
  s.touch();
}
