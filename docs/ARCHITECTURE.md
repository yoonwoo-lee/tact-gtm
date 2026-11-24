# Connet: system design

Connet is a closed loop from "here is my product" to "here are your customers, with approved messages sent and deals tracked". This document covers how it is put together: the agents, the knowledge graph and its queries, the reasoning loops that keep it honest, scoring, the approval gate, metering, and the limits.

## 1. Overview

```mermaid
flowchart LR
  rep([Founder or rep]) -->|describes the product| ui[Next.js page]
  ui -->|POST /api/run, /api/action| api[Route handlers]
  ui -->|polls /api/state| api
  api --> pipe[Pipeline]

  subgraph Agents
    planner[Planner]
    builder[Builder]
    reviewer[Reviewer]
    security[Security]
  end
  pipe --> planner & builder & reviewer & security

  builder -->|search| tavily[(Tavily)]
  builder -->|extract, write| gemini[(Gemini)]
  reviewer -->|review| gemini
  builder -->|emails| hunter[(Hunter.io)]
  builder -->|MERGE| graph[(Neo4j / embedded graph)]
  builder -->|Cypher| graph
  pipe -->|usage events, wallet| flex[(Flexprice)]
  pipe -->|hand-offs| band[(Band room)]

  verify{{Quote check<br/>plain code}}
  builder -. every proposed fact .-> verify
  verify -. kept only if the quote is on the page .-> graph
```

One Next.js process holds the workspace in memory (`lib/store.ts`), saves it to `.data/workspace.json`, and serves three endpoints. The page polls `/api/state` about once a second while a run is going, so the graph and the agent feed fill in live.

Every external service has a fallback. With no keys the same code runs on invented sample data (`lib/sample/`), which is how the test suite runs and how the demo survives a dead network.

## 2. The agents

Four roles, matching the Band multi-agent brief. They are steps in one pipeline, each with its own prompt and its own job, and each says what it is doing in the activity feed (and in a Band room, when configured).

| Agent | Job | Where |
|---|---|---|
| Planner | Reads the product, writes the ICP, sets the search plan, sums up, reads replies | `lib/agents/icp.ts`, `lib/pipeline.ts` |
| Builder | Searches, extracts accounts, signals, people and competitors, watches job postings, writes to the graph, runs graph queries, enriches, drafts | `lib/agents/discover.ts`, `lib/agents/radar.ts`, `lib/agents/outreach.ts` |
| Reviewer | Checks every quote against its source (code) and every claim in a draft against the facts (a second model call plus code) | `lib/verify.ts`, `lib/agents/outreach.ts` |
| Security | Checks what is about to leave: links, stray addresses, opt-out line, guessed addresses | `securityCheck` in `lib/agents/outreach.ts` |

Human in the loop: the rep accepts or dismisses suggested segments, approves, edits or rejects every message, and moves or closes deals. Nothing is sent without an approval.

## 3. Knowledge graph

### Ontology

Nodes: `Product`, `Company`, `Person`, `Competitor`, `Signal`, `School`, `JobPost`. Every node also carries the label `Tact` and a unique `id`.

| Relationship | From → to | Meaning |
|---|---|---|
| `MATCHED_TO` | Company → Product | The account fits the ICP. Carries `score`, `tier`, `stage`, `segment`. |
| `WORKS_AT` | Person → Company | Current role, with `title`. |
| `PREVIOUSLY_EMPLOYED_AT` | Person → Company | A past employer, with the `quote` and `sourceId` that prove it. |
| `STUDIED_AT` | Person → School | With `quote` and `sourceId`. |
| `ABOUT` | Signal → Company | A buying signal (`kind`, `date`). |
| `POSTED` | Company → JobPost | The account put up this job posting (`title`, `date`, `team`, `reportsTo`, `firstHire`, `url`). |
| `NEEDS` | JobPost → Product | The role this posting is for is one the product serves. |
| `USES` | Company → Competitor | The account uses a competing tool. |
| `COMPETES_WITH` | Competitor → Product | With `category`. |
| `CONTACTED_VIA` | Product → Person | A message was approved and sent (`channel`, `at`, `messageId`). |
| `REPLIED_TO` | Person → Product | They replied (`intent`, `at`). |

The founder is a `Person` with `isFounder: true`, linked to their schools and past employers. That is what makes warm paths a graph question.

### Storage

`lib/graph/index.ts` writes every node and edge to an embedded graph (which the page draws and which is saved to disk) and, when `NEO4J_URI` is set, mirrors it to Neo4j with `MERGE`. Reasoning queries run in Neo4j when it is connected. If Neo4j fails three times, the app carries on with the embedded graph and the "Sample data / Live data" panel shows which engine is answering.

### Reasoning queries (`lib/graph/cypher.ts`)

**Warm paths.** People at target accounts who share a school or employer with the founder (four hops):

```cypher
MATCH (f:Person:Tact {isFounder: true})-[fe:STUDIED_AT|WORKS_AT|PREVIOUSLY_EMPLOYED_AT]->(hub:Tact)
      <-[pe:STUDIED_AT|WORKS_AT|PREVIOUSLY_EMPLOYED_AT]-(p:Person:Tact)
      -[:WORKS_AT]->(c:Company:Tact)-[:MATCHED_TO]->(:Product)
WHERE p <> f AND c <> hub
RETURN p.id AS personId, c.id AS companyId, hub.id AS hubId, hub.name AS hubName,
       labels(hub) AS hubLabels, type(fe) AS founderEdge, type(pe) AS personEdge
```

**Referral paths.** After a reply: former colleagues of the person who replied, now at another target account and not yet contacted:

```cypher
MATCH (p1:Person:Tact)-[:REPLIED_TO]->(:Product),
      (p1)-[:WORKS_AT|PREVIOUSLY_EMPLOYED_AT]->(hub:Company:Tact)
      <-[:PREVIOUSLY_EMPLOYED_AT]-(p2:Person:Tact)
      -[:WORKS_AT]->(c:Company:Tact)-[:MATCHED_TO]->(:Product)
WHERE p1 <> p2 AND c <> hub AND NOT (:Product)-[:CONTACTED_VIA]->(p2)
RETURN DISTINCT p1.id AS fromPersonId, p2.id AS toPersonId, c.id AS companyId,
       hub.id AS hubId, hub.name AS hubName
```

**New job postings linked to buying cycles.** The brief's own example. Target accounts that put up a posting for a role the product serves in the last 30 days, newest first:

```cypher
MATCH (c:Company:Tact)-[:MATCHED_TO]->(:Product),
      (c)-[:POSTED]->(j:JobPost:Tact)-[:NEEDS]->(:Product)
WHERE j.date IS NOT NULL AND j.date >= toString(date() - duration({days: 30}))
RETURN c.id AS companyId, j.id AS jobId, j.title AS title, j.date AS date,
       j.team AS team, j.firstHire AS firstHire
ORDER BY j.date DESC
```

**Competitor displacement** and **signals per account** are the two shorter queries in the same file.

Each query run is shown in the activity feed with its Cypher, row count and time, and is metered as a `graph.query` usage event.

### Two nets over the one graph (`lib/graph/nets.ts`)

The page shows the same graph from two sides, with a switch between them.

- **The product's net** is who the product is connected to: the product in the middle, the companies matched to it, their people, their reasons to write and the competitors. The founder and the schools and past employers people came through are left out of it.
- **Your net** is who the founder can reach: the founder in the middle, and every person found, placed on a ring by how many people stand between them. Ring one shares a school or employer with the founder, or has already had a message. Ring two is tied to someone on ring one (the same company, the same past employer, the same school): one introduction away. Everyone else stands on the outside ring, "no way in yet". Only the schools and companies that lie on a way to someone are drawn.

The distance is a breadth-first walk from the founder over `STUDIED_AT`, `PREVIOUSLY_EMPLOYED_AT`, `WORKS_AT` and messages sent, done in plain code on the nodes and edges the page already has (`reach`). A step on to a person counts one; a step on to a school or company counts nothing. Hovering a person says how they are tied ("One introduction away: Maya Okafor shares UCLA with you, and both are tied to Lumen Education"). Nothing is stored twice and no model is involved; `tests/nets.test.ts` covers it.

## 4. Reasoning loops

### Propose, then verify (discovery)

1. The builder searches (Tavily) and keeps the text of each result as a `Source`.
2. The model is shown the numbered pages and asked for companies, signals, people and competitors. Every item must carry `{source: n, quote: "..."}`.
3. `lib/verify.ts` reduces both texts to their words and figures in order (case, punctuation, quote marks, hyphens and spacing are ignored; `$` and `%` are kept) and checks that the quote is in the text of source `n`. A changed word or number fails. A quote joined with "..." needs every part to be there. Fewer than three words is not proof.
4. Two more conditions in `lib/agents/discover.ts`: the page must name the company the fact is pinned on, and a quote about a person must contain their name.
5. What passes is kept with its source link. What fails is dropped and counted; the reviewer reports "checked 23 quotes, 20 found word for word, 3 dropped" with the list.

Websites follow the same rule: a domain is only kept if a page shows it. LinkedIn URLs are only taken from a search result that is that profile. Email addresses come from Hunter with its verification status; an address built from the company's pattern is always labeled a guess.

What the model reads from each page is chosen, not just cut off: a page is mostly menu and footer, so `lib/passages.ts` keeps the paragraphs that share words with the query (and the sentences beside them), up to about 3,200 characters, each exactly as it stands on the page so quotes can still be checked.

### Write, review, rewrite once (outreach)

1. `buildFacts` numbers the facts the writer may use: only verified signals, verified company evidence, the contact, the warm path, the competitor in use, and the product description.
2. The writer returns the email plus a list of claims, each pointing at a fact number.
3. The reviewer (a separate model call with a strict prompt) lists every statement about the recipient, their company or the world and marks it supported or not. Plain code adds a check the model cannot talk its way past: every number in the email must appear in the facts.
4. On a fail, the writer gets the reviewer's notes and rewrites once. If it still fails, the draft goes to the rep marked "needs you" with the unsupported claim shown.
5. The security step removes links that are not to the product's own site, flags stray email addresses, adds a one-line opt-out, and notes when the address is a guess or missing.

### When not to write

- No buying signal and no warm path: the account is **held**. The rep can ask for a draft anyway; the audit trail records that.
- A sign of a bad fit, a do-not-contact domain, or an unsubscribe reply: the account is **left out** and the agent refuses to draft.

## 5. Scoring (`lib/score.ts`)

Plain arithmetic, no model, so the same lead always gets the same score and every point has a reason.

| Part | Max | Rule |
|---|---|---|
| Segment | 20 | In a target industry or an accepted expansion |
| Size | 12 | Size stated in a source |
| Buyer found | 16 | A contact whose title matches a target persona |
| Proof | 12 | 6 per checked quote, up to two |
| Why now | 24 | Signal kind (funding 14, hiring 12, launch, leadership and expansion 10, ...) times recency, plus the Radar's bonuses below |
| Competitor in use | 7 | A `USES` edge to a competitor |
| Warm path | 9 | A warm or referral path exists |

Tier A is 70 and up, B is 45 and up, C below. A sign of a bad fit forces C.

The Hiring Radar adds two reasons inside the same 24-point cap (`radarBonus`), each printed next to the points it earns:

| Reason | Points | Rule |
|---|---|---|
| A first hire | 6 | A posting in the last 30 days whose title or quote says `first`, `founding` or `build the team`: a function that does not exist yet, not a backfill |
| Building a team | 5 | Three or more postings on one team inside 30 days |

`bestContact` also prefers whoever a posting says the role reports to, ahead of a plain persona match, and their title goes to the front of the people search.

## 6. Pipeline, attribution and analytics

Stages: Matched → Contacted → Replied → Meeting booked → Closed (won or lost). Each lead records who made its last move (`agent` or `rep`), and every action is appended to the audit trail (`AuditEntry`: time, actor, agent, action, lead, message, from, to, note).

- The agent moves a lead to Matched, and to Replied or Lost when it reads a pasted reply (`classifyReply`).
- The rep moves a lead to Contacted by approving a message, and anywhere else by dragging the card.

Analytics are computed from the audit trail on the page: stage-to-stage conversion, by segment, by tier, replies per message for variant A (signal-led) and variant B (problem-led), and how many moves were made by the agent versus the rep.

### The Deal Room

`decideMessage(id, "approve")` is the one place a message counts as sent, so it is the one place a deal room opens (`openDealRoom`, `lib/dealroom.ts`). The call is wrapped: a room that cannot be built is logged and the send stays recorded.

- **Shape.** `DealRoom { id, leadId, members, messages[], tasks[], positiveReply, clientInvited, invitedBy, invitedAt, meetingId, openedAt }`, held on the workspace as `dealRooms` and saved with it. Older saved workspaces have no such field, so it is read as `|| []`.
- **Idempotent.** One room per lead. `openDealRoom` returns the room that is already there rather than building a second one, so a second approval, a replay, or a hot reload cannot double it.
- **Facts only.** The brief is assembled from what the rest of the app already checked: the strongest signal whose `evidence.verified` is true and the source it cites, `lead.score.parts`, `lead.warmPaths[0]`, and the subject and first line of the sent `Message`. No model call is made to write it, so there is nothing new to verify.
- **Tasks by role.** Members are matched by what their role says (`/sales/i`, `/marketing/i`, `/finance/i`, `/ceo|chief executive|founder/i`), so an edited team still gets the right tasks and a role nobody holds simply gets none. The CEO task is gated on `score.tier === "A"`.
- **On a reply.** `logReply` calls `noteReplyInDealRoom` last, after the meeting has been proposed, so the room can link the `Meeting` the reply produced. A positive intent sets `positiveReply`, which is what unlocks the invite.
- **The gate.** `inviteClient` throws unless `positiveReply` is set, and records `invitedBy: "rep"` with an audit entry. Nothing in the agent's path calls it.
- **Band.** Opening a room and a reply arriving in one are said in the agents' feed through `store.log(..., "say", ...)`, which already mirrors to Band when keys are set, so a deal room can be followed from Band Desktop with the rest of the hand-offs. No new provider, and no Band means no difference.

### The deal rooms over MCP (`app/api/mcp/route.ts`)

JSON-RPC 2.0 over HTTP, protocol `2025-06-18`, hand-rolled: `initialize`, `ping`, `tools/list`, `tools/call`, and a 202 for notifications. No SDK, no new dependency.

- **Four tools.** `list_deal_rooms`, `get_deal_room`, `post_to_deal_room`, `complete_task`, reading through `lib/dealroom.ts` like the app's own screen does.
- **What is deliberately absent.** No tool approves a draft, records a send, or invites the client. Those are the two human gates in this app, and nothing reachable over a public URL can reach them. `tests/mcp.test.ts` asserts the tool list and that a call to `invite_client` is an error.
- **Shut by default.** No `CONNET_MCP_TOKEN`, no endpoint: it answers 404, since a public URL (ngrok) is what makes it reachable at all. With a token set, every call must carry it as `Authorization: Bearer` or `x-api-key`.
- **Marked.** Anything said through it is stored with `from: "outside"`, shown as **Said from outside this app**, and written to the audit trail, so a line in a room always says where it came from.

## 7. Metering and the credit gate

`store.spend()` writes every metered action to a local ledger and sends it to Flexprice (`POST /events` with `event_name`, `external_customer_id`, `event_id`, `properties`).

| Event | Credits |
|---|---|
| `discovery.run` | 5 |
| `lead.enriched` | 2 |
| `outreach.drafted` | 1 |
| `radar.scan` | 3 |
| `outreach.sent`, `graph.query` | 0 (counted, not charged) |

Before a paid step, `canSpend()` checks the balance. The balance starts from the Flexprice wallet when one can be read for the customer and follows it down whenever Flexprice has charged more than Connet counted; Connet also counts every spend itself, so the gate works even when the events have no price attached in Flexprice yet. When the balance is too low the step is refused with a message and the run moves on without it. The top-up button calls Flexprice's wallet top-up when a wallet exists.

## 8. Rate limits and replay

A run makes about 35 model calls and 20 searches. Three things keep that from failing in front of people:

- **Limits are read, not guessed.** A 429 from Gemini says which quota was hit. A per-minute limit is waited out (the feed says "waiting 17 s"), with at most `LLM_CONCURRENCY` calls in flight. A per-day limit retires that model and the next one in `GEMINI_MODELS` takes over. A model the key cannot use is dropped; one that refuses the thinking setting is asked again without it; a reply that is not JSON is asked for once more.
- **Every live answer is saved** (`lib/cache.ts`), keyed by exactly what was asked: the search query, the model prompt, the domain. Asking the same thing again within 72 hours reads the saved answer. A whole run can therefore be replayed with no network, and a changed brief only sends the questions that are new.
- **The page says so.** A replayed run is labeled "Live data, replayed", and the connections panel gives the count.

## 9. Band

When `BAND_CHAT_ID` and agent keys are set, every hand-off in the activity feed is posted to the Band room through the agent API (`POST /agent/chats/{id}/messages` with an @mention of the receiving agent, or `/events` for a thought). Each of the four agents posts with its own key. The approval itself happens in Connet.

## 10. Security

- Keys live in `.env.local` and are only read on the server. Nothing with a key in it is sent to the browser.
- Outbound messages pass the security step described above, and sending is simulated in this build.
- `.github/workflows/security.yml` runs Snyk dependency and code scans on every push when a `SNYK_TOKEN` secret is set, plus lint, tests and a build.
- Only professional, public information is collected (name, role, company, business address), always with its source, and a do-not-contact list is honored.

## 11. Limits

- One workspace per server process, held in memory and saved to a local file. A serverless host would need the workspace stored elsewhere.
- Sending and inbox reading are not connected: approval records the send, replies are pasted in.
- The quote check is strict by design. A model that paraphrases instead of quoting loses that fact.
- Enrichment depends on the page showing the company's website; otherwise the rep adds the domain.
- The author could not reach the live services from the build machine. The code that talks to them is tested against stand-ins that answer in each service's documented format (`tests/live.test.ts`), and the Cypher passes Neo4j's own syntax checker. `npm run doctor` checks the real services, including whether Neo4j accepts every reasoning query.
