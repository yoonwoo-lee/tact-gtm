# Connet

**The go-to-market agent that thinks before it sends.**

Describe your product in plain words. Connet works out who should buy it, finds real accounts and the people to talk to, proves every fact with a quote from its source, looks for a warm way in before it writes a cold email, and drafts outreach that you approve. Everything it learns goes into a knowledge graph you can watch being built.

Built for HackwithBay 4.0 ("Thoughtful Agents for Productivity") by Yoon Woo and Skylar.

## What makes it different

1. **It cannot make things up.** The model only proposes facts. Each one must come with a quote, and plain code checks that the quote is on the page it cites, word for word. No match, no fact. A company with no checked quote does not appear at all.
2. **It needs a reason to write.** An account with no buying signal is held, not emailed. An account that shows a bad fit (a hiring freeze, a do-not-contact) is left out and the agent refuses to draft for it.
3. **It looks for a warm way in.** The graph links the founder's schools and past employers to people at target accounts, and after a reply it finds former colleagues of that person at other accounts ("ask Maya for an introduction to Hannah").
4. **It watches job postings, not just companies.** The Hiring Radar works the other way round from the rest: it reads the job boards for the roles the plan names, and every posting that holds up becomes a lead with its "why now" already attached. A job went up yesterday; thirty seconds later there is a checked, reviewed email waiting for approval.
5. **Every draft is reviewed before you see it.** A second model call checks each claim against the checked facts, and plain code rejects any number that is not in them. One rewrite is allowed; after that the draft comes to you marked "needs you". A security pass checks links and adds a way to opt out. Nothing is sent without your approval.

## Run it

Needs Node 20 or newer.

```bash
npm install
cp .env.example .env.local     # then paste in the keys you have
npm run doctor                 # checks each key with one small real call
npm run dev                    # http://localhost:3000
```

No keys yet, or no network at the venue:

```bash
npm run demo                   # the whole app on sample data, no network
```

For the demo itself, the production build is faster and has no dev overlay:

```bash
npm run build && npm start
```

Other commands: `npm test` (51 checks, no network: the sample run, plus the live code run against stand-ins for every service), `npm run smoke` (the whole run printed in the terminal), `npm run lint`, `npm run clean` (clears the build cache: use it if the page looks out of date after a pull), `npm run fresh` (deletes the saved answers, see below).

## Keys

Every key is optional. A missing key switches that one part to sample data, and the page says so (the "Sample data" pill at the top right lists what is live).

| Key in `.env.local` | What it turns on | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | The model: ICP, extraction, writing, review | aistudio.google.com/apikey |
| `TAVILY_API_KEY` | Live web search with page text to check quotes against | tavily.com |
| `HUNTER_API_KEY` | Business email addresses and their verification status | hunter.io |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | Neo4j as the graph database; reasoning queries run there in Cypher | console.neo4j.io (Aura free) |
| `FLEXPRICE_API_KEY` | Usage events sent to Flexprice; the credit gate reads the Flexprice wallet | flexprice.io |
| `BAND_CHAT_ID`, `BAND_API_KEY_*` | The agents' conversation mirrored into a Band room | band.ai |
| `TEAMILY_AGENT_TOKEN`, `TEAMILY_AGENT_ID` | Each deal room mirrored into its own Teamily conversation | teamily.ai: your agent &rarr; Agent API &rarr; RESTful API for servers |
| `CONNET_MCP_TOKEN` | `/api/mcp`: lets an outside agent (Teamily) read and work the deal rooms | any long random string of your own |

**Never commit `.env.local`.** It is in `.gitignore`.

### What a run costs, and replay

One run on live data makes about **35 model calls, 20 web searches and up to 3 Hunter lookups**. That matters:

- **Gemini.** A free key allows few requests a minute and a small number a day per model. Connet waits out a per-minute limit (the feed says so) and moves to the next model in `GEMINI_MODELS` when one runs out for the day, but a free key may not finish a run. Adding billing in Google AI Studio (the smallest top-up) removes the problem. On a free key, set `LLM_CONCURRENCY=1`.
- **Tavily.** The free plan's 1,000 searches a month is about 50 runs.
- **Hunter.** The free plan's 25 domain searches a month is about 8 runs' worth.

So every answer from a live service is **saved on this machine** (`.data/cache`, 72 hours). Running the same brief again reads the saved answers: the same real companies and quotes, no requests spent, no network needed. The header then says "Live data, replayed", and the connections panel says how many lookups were replayed. Change the brief and only the new questions go out. `npm run fresh` deletes the saved answers; `TACT_CACHE=0` turns saving off.

For a demo: run your brief once on live data while the wifi is good, then present from the replay.

### Flexprice setup (one command)

1. Sign up at flexprice.io, create an API key with Read & Write (it is shown once), and paste it into `.env.local` as `FLEXPRICE_API_KEY`.
2. Run `npm run setup:flexprice`.

The command finds which region your account is on, creates the customer `tact-demo`, a metered feature for each event Connet sends (`discovery.run`, `lead.enriched`, `outreach.drafted`, `outreach.sent`, `graph.query`), and a wallet with 30 credits, then sends one test event. It is safe to run twice.

Connet starts from the wallet's balance and stops paid steps at zero. If the events have no price attached in Flexprice, the wallet does not move by itself; Connet then keeps its own count from the wallet's starting balance, and the credits panel says so. Without a Flexprice key, credits are kept in a local ledger.

### Band setup (one command, or three minutes by hand)

1. Sign up at band.ai. In Settings, API Keys, create a key and paste it into `.env.local` as `BAND_USER_API_KEY`.
2. Run `npm run setup:band`.

The command registers four agents (Tact Planner, Tact Builder, Tact Reviewer, Tact Security), creates a room, adds the agents and you to it, saves the room id and the four agent keys in `.env.local`, and posts a first line in the room. From then on every hand-off between agents is posted there with an @mention.

If your Band plan refuses the first step, the command says so and prints the by-hand steps: create four external agents in Band, generate a key for each, paste the four keys, and run the command again for the room.

## How a run goes

1. **Target.** The planner reads the product and writes the ideal customer profile: industries (with NAICS codes), company size, personas, trigger events, signs of a bad fit, each with a confidence. It also suggests adjacent segments, which you accept, adjust or dismiss.
2. **Leads.** The builder searches each segment and extracts companies, each fact with a quote. The verifier keeps only what is on the page.
3. **Signals and people.** One more search per account for fresh buying signals, one for the people in the roles the ICP names, and one for people who share a school or employer with the founder.
3b. **Job postings.** The Hiring Radar reads the boards for the roles the plan names and turns each posting it can prove into a hiring signal, on an account already found or on a new one.
4. **Competitors.** Positioning, pricing where the page states it, and how the product differs.
5. **Graph reasoning.** Multi-hop queries: warm paths, accounts using a competitor, signals per account. Then a fit and intent score from 0 to 100, as plain arithmetic you can read, and a tier.
6. **Outreach.** The agent looks up email addresses for the best leads and drafts a message to the top three (both metered). The rest wait until you click **Draft**. Each draft is reviewed, rewritten once if needed, security-checked, and queued for you.
7. **Pipeline.** Approve, edit or reject. Log a reply and the agent reads it, moves the account, and looks for referral paths. Every move is recorded with who made it, the agent or you.

## Hiring Radar

A job posting is a buying signal with a date on it. When a company posts "hiring our first Head of RevOps", it is about to buy tools for that role, and it has said so in public.

- **What it watches.** Three to six job titles worked out from the plan: the personas who buy this, plus any trigger that names a role of its own. `lib/agents/radar.ts`.
- **What it keeps.** A posting is kept only when its quote is on the page it cites and that page names the company, the same rule as every other fact here. What it cannot prove, it drops and counts.
- **What it adds.** Each kept posting becomes a `hiring` signal on a lead, so people, warm paths, scoring and drafts carry on unchanged, plus a `JobPost` node on the graph.
- **What it is worth.** A first hire for a function (`first`, `founding`, `build the team`) is worth 6 more than a backfill. Three or more roles on one team inside 30 days adds 5 more. Both stay inside the 24-point cap on "Why now".
- **Who to write to.** When a posting says what the role reports to, that person comes first: they sign for the tool.
- **Scanning again.** **Scan for new job posts**, above the leads, runs only the Radar on the plan in hand and adds only postings that are not already there. It costs 3 credits, is metered as `radar.scan`, and is refused when the credits will not cover it. There is no scheduler: postings go up during the day, so press it again. A daily rerun would be a cron job calling the same `scanJobs()`.
- **Offline.** `npm run demo` includes four invented postings, three of them on one team at one company, and one whose quote is not on its page so the check can be seen working.

A scan is at most six searches, deduped by URL and capped at ten pages for a single extract call, to stay inside the Tavily and Gemini quotas.

## Deal Room

Finding the lead and writing the email is half the work. The other half is the four people inside your own company who have to do something about it.

- **When it opens.** The moment a rep approves the first email to a company and it is recorded as sent. One room per lead: approving again opens nothing new, and a room that fails to open is never the reason a send goes unrecorded. `lib/dealroom.ts`.
- **Who is in it.** The team from Settings: CEO, Sales Director, Marketing Director and Finance Director to start with, names and roles editable. The client is **not** in it.
- **The brief.** One post from the agent, and every line of it is a fact that was checked somewhere else in this app: the company and what it does, who was written to, the strongest signal with its source, the score and the parts that earned it, the warm way in, and the subject and first line of the email that went out. It writes no new claims.
- **The tasks.** Sales owns the deal and books the meeting, Marketing prepares a case study for the lead's segment, Finance prepares pricing for a company that size. The CEO is only given a task on a tier A lead. A rep ticks them off.
- **When they reply.** The room hears the reply and what to do next. On a reply with interest, the owner's task becomes booking the meeting that is already on the Calendar, and an **Invite client** button appears.
- **Inviting the client.** A rep press only, never the agent's, never before a reply with interest, and it records who pressed it, like every other approval here.
- **In Teamily.** With `TEAMILY_AGENT_TOKEN` and `TEAMILY_AGENT_ID` set, opening a room also starts a Teamily conversation for that deal, with the brief and who owes what in it, and the reply lands in the same thread. Teamily gives each `user` its own conversation and memory, so **one deal is one conversation** - nobody makes a chat by hand. The call is idempotent, never waited on, and never able to fail a send: with no key, everything stays in this app and the connections panel says so.
- **Where it shows.** A **Deal room** fold on the profile card, and a **Deal room** chip on the Pipeline card. Opening a room, and a reply arriving in one, are also said in the agents' feed, which carries them to the Band room when Band keys are set.

### Working a deal room from another AI client (MCP)

The room is offered as MCP tools rather than copied anywhere: point any MCP client at `/api/mcp` and the deal room can be read and worked from inside it - Claude Desktop, Claude Code, Cursor, or an agent of your own.

This started as a Teamily connection. Teamily's app takes agents that can *be* reached; we found no way to point one of its agents *out* at an MCP server, and no published endpoint shapes to push into it either, so nothing here claims to talk to Teamily. The endpoint stands on its own and works with any MCP client.

| Tool | What it does |
|---|---|
| `list_deal_rooms` | The rooms that are open: company, tier, score, stage, how many tasks nobody has done |
| `get_deal_room` | One room in full: who is in it, the brief, everything said, who owns what |
| `post_to_deal_room` | Say something in a room. It is marked **Said from outside this app** |
| `complete_task` | Tick a task off, or put it back |

**Approving a draft is not a tool, and neither is inviting the client.** Reading what was written is fine; deciding to send it, and deciding to put the client in the room, stay presses in this app's own screen. There is a test that says so.

Turn it on with `CONNET_MCP_TOKEN` in `.env.local`. **It is not a key from anybody: it is a password you make up**, and it is what stands between the deal rooms and anyone who finds the public URL. Without it the endpoint answers 404.

```bash
echo "CONNET_MCP_TOKEN=$(openssl rand -hex 32)" >> .env.local
```

Then put it on a public URL, if the client is not on this machine (a local client, like Claude Code, can use `http://localhost:3000/api/mcp` directly):

```bash
npm run tunnel            # the app on port 3000
npm run tunnel -- 3001    # or whichever port it is on
```

That opens a Cloudflare quick tunnel (no account, no key: `brew install cloudflared`), checks the endpoint really answers through it, prints the URL and header to paste into the client, and writes both to `teamily-mcp.local.json`, which is git-ignored because it carries the token. The URL is new every time, so re-paste it after a restart. **Ctrl-C closes the tunnel**, and the endpoint goes back to being reachable only from your machine - do that when you are done.

## The screen

The screen is built so that the next thing to do is never a guess.

- **One line says what to do next.** At the top of the work: "3 messages are waiting for your approval", "Next: write to Maya Okafor", with the button that does it.
- **The best lead is set apart.** Leads opens on one card, "Best to contact first": the person, why now, the way in, the address. The rest follow in order. Companies on hold and left out are folded away below.
- **Every company and person has a profile card.** Click a row, or anything on the graph. The card opens on three things: who to write to (title, address, LinkedIn), why now, and the way in. The other people there, the score bar by bar with the reason for each point, and the rest of the proof are folded underneath. The arrow keys flip through the entries.
- **Little on each screen.** A lead is one row: a person, one line on why now, one button. The detail is always one click away, never in the way.
- **A draft shows what to delete.** The message stands beside what the second agent made of it. A sentence that makes a claim nothing backs is struck out in red, with one button to delete them all. What an agent added (a way to opt out) is green. What is backed links to its source.
- **The look is blue into purple:** one soft field behind the window, white sheets on it. In "Your net" the field turns purple all over.
- **Field-level confidence.** Every field of the ideal customer the agent inferred (each segment, company size, each role, each trigger, each suggested segment) carries the agent's own confidence from 0.00 to 1.00, with a bar and a word (High, Medium, Low), shown when you open that line. A verified address carries the lookup's.
- **Pick one kind out.** Point at a name in the legend above the graph (Company, Person, Reason to write, Competitor, Draft waiting for you) and that kind lights up and is named while the rest fades back. In "Your net", point at a ring and it lights up and says what it means.
- **Read what was sent.** Press a card in Pipeline to read every message written to that lead; a row under Decided in Approve opens the same way.
- **A calendar.** When a reply you log agrees to talk, the agent puts a meeting on the calendar under Pipeline as a proposal, at the day and time the reply names if it names one. You book it, then add it to Google Calendar or download a calendar file. Nobody is invited for you.
- **Unreadable pages are skipped.** Text from a PDF whose font was not decoded (letters turned into capitals, digits and symbols) is cut out before it is read, so it cannot become a "company".
- **Any product.** With keys set, describe any product and search. A search that finds fewer than three companies tries again, wider (news of growth and job posts in each segment). If it still finds nobody it says which step failed: the search, the model, or the quote check.
- **Logos on the graph.** A company's disc shows the icon its own website publishes (fetched by your browser from Google's public favicon service), and a school with a one-word name is tried as name.edu. Where there is none, the disc stays white. Sample data has no real sites, so it shows none.
- **One menu.** The button at the top left slides a menu in from the left: Target, Leads, Approve, Pipeline, and Settings.
- **You set how much the AI may add on its own** (menu, Settings): Nothing (checked facts only; anything else is cut before you see it), A little (anything it could not back is marked for you), or More (a sentence or two of its own pitch, each marked). A number that is in no source is always flagged.
- **Keep or delete each unbacked claim on its own.** A kept claim is listed as kept by you, not as backed.
- **The match score is out of 100 and colored:** green from 70, amber from 45, red below.
- **Two nets, one switch.** Above the graph: "Glyph's net" shows who the product is connected to (companies, their people, reasons to write, competitors). "Your net" puts you in the middle and sets everyone found on a ring by how close they are: the same school or employer, one introduction away, or no way in yet. Hover a person to read how you are tied to them.
- **The graph shows messages moving.** When a draft is asked for, dots run from the product to the person it is for. A dashed white ring round a person means a draft is waiting for your approval. When you approve, the dots run again, dark this time. The lead to contact first wears a "Best first" flag.
- **No address, no send.** A draft with no address cannot be approved. Its card offers a lookup or a box to type the address in. (This build never sends real email in any case: approving records the message as sent, and nothing leaves your computer.)
- **Nothing is sent without you.** A draft stops under Approve until you click approve. The same rule is stated wherever a draft is mentioned.
- **Plain names.** "Find emails" looks up the people at a company and their addresses (Hunter.io) and marks each one verified or guessed.

## What is real and what is simulated

- **Sending is simulated.** Approving a message records it as sent and moves the account. Nothing leaves the machine. This is deliberate: a demo should not email strangers.
- **Sample data is invented.** With no keys, the companies and people are made up (domains end in `.example`) and labeled as sample pages.
- **Replies are pasted in by the rep.** There is no inbox connection.
- **Tested here:** the whole pipeline on sample data; the live code for Gemini, Tavily, Hunter, Flexprice and Band against stand-ins that answer in each service's documented format, including rate limits, a refused setting, a model the key cannot use and a reply that is not JSON (`tests/live.test.ts`); the Cypher, with Neo4j's own syntax checker; every screen in a browser; the production build. **Not tested by the author:** the real services themselves, because the build machine could not reach them. `npm run doctor` checks each one on your machine.

## Where things are

| Path | What it holds |
|---|---|
| `lib/pipeline.ts` | The run, start to finish, and every action the rep can take |
| `lib/agents/` | ICP, discovery (accounts, people, competitors), the Hiring Radar (`radar.ts`), outreach (writer, reviewer, security) |
| `lib/verify.ts` | The quote check that every fact has to pass |
| `lib/score.ts` | Fit and intent scoring |
| `lib/graph/` | The graph: `cypher.ts` (the reasoning queries), `index.ts` (Neo4j), `memory.ts` (embedded fallback), `nets.ts` (the product's net and yours, and how far everyone is from the founder) |
| `lib/providers/` | Gemini, Tavily, Hunter, Flexprice, Band: each with a fallback |
| `lib/cache.ts` | Saved answers from live services, for replay |
| `lib/passages.ts` | Picks the paragraphs of a long page that bear on the question |
| `lib/sample/` | The invented sample market |
| `lib/dealroom.ts` | The Deal Room: the brief, the tasks, and the rep-only invite |
| `lib/store.ts` | The workspace, the activity feed, the audit trail, credits |
| `app/api/` | `state` (polled by the page), `run`, `action` |
| `components/` | The page: the graph (`GraphView`), the leads list (`LeadsTab`), the profile card (`Profile`), approvals, pipeline, the agents' feed |
| `lib/name.ts` | The product's name, from `NEXT_PUBLIC_APP_NAME` |
| `scripts/doctor.ts` | Checks your keys |
| `docs/ARCHITECTURE.md` | System design: ontology, queries, reasoning loops |
| `docs/DEMO.md` | The demo script |

## Stack

Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI, d3-force on canvas, Neo4j (with an embedded fallback), Gemini, Tavily, Hunter.io, Flexprice, Band, Snyk in CI.
