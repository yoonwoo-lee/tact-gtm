# Handoff notes

Notes between Yoon Woo's Claude and Skylar's Claude. Newest entry first.

**To add an entry:** `git pull`, add a section at the top under this text, then
`git add HANDOFF.md && git commit -m "Handoff: <one line>" && git push`. Mark anything you need from the other side `[open]` and change it to `[done]` when it is dealt with.

---

## Nov 24, 15:05. Abhishek's Claude: Deal Room, on a branch

**Where it is.** `feature/deal-room`, branched off `upstream/main` (which already has the Hiring Radar merge, PR #2). **Not pushed, not on `main`.** Same as last time: read access only, so this entry arrives when the branch does.

**Why.** Connet stopped at the email. The moment one is sent, four people inside the company have to do something about it, and today they learn about the deal by being told. Approving an email now opens an internal room with the deal already written up in it.

**Done (on the branch).**
- `lib/dealroom.ts`: `openDealRoom`, `postToDealRoom`, `noteReplyInDealRoom`, `completeTask`, `inviteClient`. `DealRoom` lives on the workspace as `dealRooms` and is saved with it; older saved workspaces read it as `|| []`.
- Opens from `decideMessage(id, "approve")`, the one place a message counts as sent. One room per lead: a second approval opens nothing. The call is wrapped, so a room that cannot be built is logged and **the send is still recorded** - nothing about the 2:20 demo moment can break because of this.
- The brief makes no new claims: the strongest signal whose quote our code found plus its source, the score and the parts that earned it, the warm path, and the subject and first line of the email that went out. No model call writes it.
- Tasks by role, matched on what the role says, so an edited team still gets the right ones: Sales owns the deal, Marketing a case study for the segment, Finance pricing for that size. CEO only on tier A.
- `logReply` tells the room last, after the meeting is proposed, so the room links the meeting on the Calendar. A positive reply rewords the owner's task to booking it and unlocks **Invite client** - rep press only, refused before a positive reply, recorded in the audit trail like every other approval. The client is never added by the agent.
- Band, instead of Teamily: opening a room and a reply arriving are said in the agents' feed, which already mirrors to Band when keys are set. No new provider, no new key.
- UI: a **Deal room** fold on the profile card (members, the feed, tasks with checkboxes, the invite) and a **Deal room** chip on the Pipeline card.
- `tests/dealroom.test.ts`, 11 checks. **105 checks pass in total**, lint and build clean.
- Docs: a Deal Room section in `README.md` and in `docs/ARCHITECTURE.md` section 6.

**Not done, on purpose.**
- **Nothing is pushed into Teamily.** Teamily does have Agent APIs (REST, MCP and an OpenAI-compatible mode, opened in their web-v2.0.0), but the console that carries the key and the endpoint shapes is behind a login at `teamily.ai/developers`, so I had no paths to write against and did not invent any. Instead the room is offered to Teamily - see below.
- **No Settings editor for the team.** The four roles are the default on a fresh workspace (`DEFAULT_TEAM` in `lib/types.ts`) and `settings.team` is read and honoured wherever it is set, so an editor is a form over a field that already works - it was the cheapest thing to drop against the clock.
- **`docs/DEMO.md` is untouched.** The script already runs 3:05 and needs a cut, so adding a row would make it worse. See below.

**The room offered to any AI client (`/api/mcp`).** The deal room is offered as MCP tools - `list_deal_rooms`, `get_deal_room`, `post_to_deal_room`, `complete_task` - so a client pointed at the endpoint can read a room and work it without anybody opening this app.

This was meant to be the Teamily connection and it is not: we went through the Teamily app signed in and found no place to add an external MCP server (its agents are reached, they do not reach out), and no published REST shapes to push into either. **Nothing in this branch claims to talk to Teamily.** The endpoint is a plain MCP server and works with Claude Desktop, Claude Code, Cursor, or anything else that speaks MCP.

- JSON-RPC 2.0 over HTTP, protocol `2025-06-18`, hand-rolled in `app/api/mcp/route.ts`. No SDK, no new dependency.
- **Approving a draft is not a tool, and neither is inviting the client.** Those are the two human gates and nothing reachable over a public URL can reach them. `tests/mcp.test.ts` asserts the whole tool list and that `invite_client` comes back an error.
- Shut unless `CONNET_MCP_TOKEN` is set - a password you make up, not a key from anybody. Unset, it answers 404, which is what a live run should have until the moment it is wanted. `npm run tunnel` (or `npm run tunnel -- 3001`) opens a Cloudflare quick tunnel, needs no account, checks the endpoint answers through it, and writes the URL and header to paste into Teamily into `teamily-mcp.local.json` (git-ignored). Ctrl-C takes it off the internet again.
- Anything said through it is stored `from: "outside"`, shown as **Said from outside this app**, and written to the audit trail.
- `tests/mcp.test.ts`, 8 checks. **113 checks pass in total**, lint and build clean.

**Need.**
- `[open]` Yoon Woo: if a Teamily connection is still wanted, it needs something we could not find today: either a way to point a Teamily agent at an MCP server, or their REST base URL, auth header and paths. Both are behind a login and neither is published. Put any key in `.env.local`, never in chat or in this file.
- `[open]` Yoon Woo: review the branch. It touches `lib/pipeline.ts` in two places (the approve branch of `decideMessage`, and the end of `logReply`), both wrapped in try/catch. Nothing touches the approval gate itself, `lib/name.ts`, or the quote check. No existing test changed. It has never been run against the live services.
- `[open]` Skylar: the Deal Room needs no row of its own. At **2:20**, after "Approve and send", add to what you already say: "and the team gets a room with the deal already in it - the brief, and a task each." At **2:30**, when the reply is read, the room's tasks update and **Invite client** appears; the line is "the client is not in that room until I put them there." That is about ten seconds across two rows you already have, instead of fifteen on a new one.

## Nov 24, 12:20. Abhishek's Claude: Hiring Radar, on a branch and in a pull request

**Where it is.** `feature/hiring-radar`, pushed to a fork (`abhie2005/-connet`) and opened as a pull request against `yoonwoo-lee/tact-gtm`. **Not on `main`.** I have read access to this repo, so I could not follow the handoff rule's "add an entry on `main` and push it" — this entry arrives when the PR is merged. Yoon Woo: nothing of mine is on `main` until you merge it.

**Why.** Job postings are public buying signals. Connet finds companies and then looks for a reason to write; the Radar works the other way round and starts from the posting, so a lead arrives with its "why now" already attached. It also answers the brief's own graph example, "linking new job postings to buying cycles", which nothing in the repo covered yet.

**Done (on the branch).**
- `lib/agents/radar.ts`: reads 3 to 6 roles off the plan (the personas, plus any trigger that names a role), searches the job boards with a new `purpose: "jobs"`, and keeps a posting only when its quote is on the page it cites and that page names the company. What it cannot prove it drops and counts, like everything else.
- Each kept posting becomes a `hiring` Signal on an existing or new lead, so people, warm paths, scoring and drafts carry on unchanged. `buildFacts` already hands the writer a signal's quote, so an email can open with "Saw you're hiring your first Head of Revenue Operations".
- Graph: `Company -[:POSTED]-> JobPost -[:NEEDS]-> Product`, in the embedded graph and the Neo4j mirror, plus a `jobSignals` Cypher query (target accounts with a posting in the last 30 days, newest first) named as the brief names it.
- Scoring: a first hire is worth 6 more than a backfill, three roles on one team inside 30 days 5 more, both inside the existing 24-point cap, each with its reason printed next to it. Whoever a posting reports to now outranks a plain persona match for who to write to.
- Watch mode: **Scan for new job posts** above the leads runs only the Radar, adds only what is not already there, costs 3 credits as a new `radar.scan` Flexprice event (added to `scripts/setup-flexprice.ts`), and is refused when the credits will not cover it.
- UI: a **Hiring** badge on each lead the Radar found (the role, a first hire said as one, how long ago, the quote on hover, linking to the posting), and **Job post** on the graph legend.
- Sample data: four invented postings so `npm run demo` shows it offline. Three are on one team at one company, so the team bonus can be seen; the Cedarline quote is not on its page on purpose, so the check can be seen dropping one.
- `tests/radar.test.ts`, 10 checks. **87 checks pass in total**, lint and build clean.
- Docs: a Hiring Radar section in `README.md`, the node, edges, query, scoring rules and meter event in `docs/ARCHITECTURE.md`, and a 15-second moment in `docs/DEMO.md`.

**Need.**
- `[open]` Yoon Woo: review the PR and decide whether it goes in. Nothing of mine touches the approval gate, `lib/name.ts`, or the `Tact`/`TACT_*` names. One existing assertion in `tests/pipeline.test.ts` moved from 1 dropped quote to 2, because a full run now reads the postings too and drops the Cedarline one; the dropped-company count is unchanged and the test says why. It has never been run against the live services.
- `[open]` Skylar: the new 15-second moment is the 1:20 row in `docs/DEMO.md`, straight after Leads. Press **Scan for new job posts**, let the new company appear with its Hiring badge, point at the badge so the quote shows, then at the credits ticking down. The line to say is in the table. With it in, the script runs **3:05** — to get back under three minutes, cut the 2:50 analytics scroll and say that line over the Pipeline board instead.

## Nov 24, 06:25. Yoon Woo's Claude: field-level confidence, 0.00 to 1.00

**Why.** Yoon Woo, 05:50, quoting the brief: "Field-level confidence scores (0.00-1.00) reflecting inference certainty".

**Done (on `main`).** Every inferred field on Target shows the agent's confidence as a bar, a score to two places and a word (0.90 High, 0.62 Medium, 0.55 Low): the Sell to and Company size boxes, each segment, each role, each trigger, each suggested segment. Only scores the model really gave are shown. 77 checks pass.

**06:10, changed at his word:** the score shows when a line is opened (with its reason), not on the closed line.

**Need.**
- `[open]` Skylar: at 0:52 press one line so the score is on screen, and say "field-level confidence": it is the brief's own phrase.

## Nov 24, 06:15. Yoon Woo's Claude: "Already decided" fixed, hover for the legend and the rings, read what was sent

**Why.** Yoon Woo, 05:39, from his live run.

**Done (on `main`).**
- **"Already decided" on a draft**: two messages had ended up with the same id (ids were handed out by count, and a message had been removed). Fixed at the source, and saved data is repaired when the app starts.
- **The legend works on hover**, not click.
- **Rings in "Your net" light up under the pointer** and say what they mean and how many people are on them.
- **Target** says what it is in one line, and its numbers read "95% sure".
- **Press a Pipeline card to read what was written to that lead.** Rows under Decided in Approve open too.
- 77 checks pass; every button pressed again (71 checks).

**Need.**
- `[open]` Yoon Woo: pull, `npm run clean`, `npm run dev`. The stuck draft should approve now (it needs an address first: see the 05:55 entry).
- `[open]` Skylar: two new things worth ten seconds in the video: hover a ring in "Your net", and press a card in Pipeline after approving.

## Nov 24, 05:55. Yoon Woo's Claude: no address, no send

**Why.** Yoon Woo, 05:28, on a draft marked "no address yet" with an Approve button: "Then how will it send the email".

**Done (on `main`).** A draft with no address can no longer be approved. Its card says why and offers **Find their address** or a box to type one in. Worth knowing for the pitch: this build never sends real email; approving records the message as sent and nothing leaves the computer. 75 checks pass.

**Need.**
- `[open]` Yoon Woo: pull, `npm run clean`, `npm run dev`.
- `[open]` Skylar: if a judge asks "does it really send?", the answer is no, by design: sending is the one step left switched off, and it would go through the same approval.

## Nov 24, 05:40. Yoon Woo's Claude: Target at a glance, and a shorter "way in"

**Why.** Yoon Woo, 05:20, looking at Target on live data: make the right side "clean and readable at first glance", "minimal words". And the way in should just say "Maya Okafor studied at UCLA" with UCLA in bold.

**Done (on `main`).**
- **Target** is three boxes (Sell to, Company size, Start in) and then lists of names with how sure the agent is. Press a line to read why. Nothing was removed, only folded.
- **Way in** reads "Maya Okafor studied at **UCLA**" on the best-lead card and the profile card.
- 74 checks pass; every button pressed again.

**Need.**
- `[open]` Yoon Woo: pull, `npm run clean`, `npm run dev`.
- `[open]` Skylar: at 0:52 the Target screen looks different (boxes and short lists). The line to say is the same; press one line to show the reasoning, then Accept under "Also worth a look".

## Nov 24, 05:25. Yoon Woo's Claude: a pass for mistakes, and a spotlight from the legend

**Why.** Yoon Woo, 04:44: "check for ANY possible mistakes before I test again and fix ALL of it." 04:53: clicking a name in the legend should brighten that kind and push the rest into the background.

**Done (on `main`).**
- A pass over everything built tonight, on saved data made to look like his live run, at his window size. Eleven things fixed; the list is in `CLAUDE.md`. The ones that mattered most: a rule that could have deleted a real company with a name like "3PL Center LLC"; deleting a body sentence replacing a short subject; the approval card wider than its panel; names on the graph written over each other; each section opening scrolled down.
- A claim that is not in the message can be dismissed. An invented figure is found and its sentence marked.
- **The legend is a row of switches**: press Company, Person, Reason to write, Competitor or Draft waiting for you and that kind lights up and is named; the rest fades back.
- 74 checks pass. Every button pressed (66 checks).

**Not checked, because it needs the live services:** the settings "Nothing" and "More", the wider search, Find their address on an approval card, Google Calendar opening with the right time.

**Need.**
- `[open]` Yoon Woo: pull, `npm run clean`, `npm run dev`, and try those four on live data.

## Nov 24, 05:00. Yoon Woo's Claude: Delete that deletes, and every button pressed

**Why.** Yoon Woo, 04:26 to 04:31, with screenshots from his Mac: Delete on a claim "didn't actually delete", Pipeline cards overlapping, a draft to the garbled company. "Make sure every button works please."

**Done (on `main`).**
- **Delete was going round in a loop when the claim was the subject line**: the plain subject it put in read enough like the claim to be marked again. Fixed, and a subject that only names the product and the company is no longer flagged at all.
- A draft to nobody starts "Hi there," (one said "Hi Mike").
- With no address, the button says **Approve**, and **Find their address** is next to it.
- **Pipeline** columns no longer run into each other at a laptop-sized window; empty columns are narrow.
- The garbled company from the earlier run is removed from saved data when the app starts.
- The agents' names in the open Agents bar are filters now. The first screen has **Back**.
- Every button in the app was pressed by script, each with a check: 60 of 60 on sample data, at a 1190 x 773 window. 71 checks pass.

**Need.**
- `[open]` Yoon Woo: pull, `npm run clean`, `npm run dev`. The garbled company and its draft should be gone on start.
- `[open]` Skylar: record at the window size the demo will be shown at; Pipeline scrolls sideways when three or more columns have cards in a small window.

## Nov 24, 04:40. Yoon Woo's Claude: a calendar, a cleaner list while searching, and no more garbled companies

**Why.** Yoon Woo, 04:14, after Dockline worked on live data (nine companies): "what is 7KH 5HJDQ???", "make this part on the right cleaner", "add a calendar function that adds meetings to a calendar once a response is given".

**Done (on `main`).**
- **The garbled company** was "The Regan Group" from a PDF whose letters came back shifted into capitals and digits. Such text is now cut out of a page before it is read, and such a name is refused.
- **While a search runs**, Leads shows five steps (Companies, Reasons to write, People, A way in, Drafts), then the companies that have a reason to write, then the rest as a row of names.
- **Calendar, under Pipeline.** Log a reply that agrees to talk and the agent puts a 30-minute meeting on the calendar as a proposal, at the day and time the reply names (or a suggestion, marked as one). "Book it" books it and moves the lead to Meeting booked. Then "Add to Google Calendar" or "Calendar file". Nobody is invited for you: that stays a thing you do in your own calendar.
- 68 checks pass. Checked on sample data. Google Calendar itself was not opened from here.

**Need.**
- `[open]` Yoon Woo: pull, `npm run clean`, `npm run dev`. Approve a draft, then Pipeline, Log a reply, Use an example reply, Book it, Add to Google Calendar: say whether Google opens with the right day and time.
- `[open]` Skylar: `docs/DEMO.md` at 2:15 changed: the reply step now ends with the meeting being booked. Worth showing: it is the "dashboard" part of the rubric doing something.

## Nov 24, 04:15. Yoon Woo's Claude: any product, a failed search that says why, the graph on every section

**Why.** Yoon Woo tried an invented product on live data (Dockline) and got "No account survived the quote check". 03:54: "why did this example fail", "get rid of glyph", "make it work for any company", and "I want the web to be shown at all times".

**Done (on `main`).**
- Why it failed could not be told from here: that message covered four different failures. Now a run that finds nobody says which one (the search, no pages, the model, no buyer named, or every quote dropped).
- A search that finds fewer than three companies tries again, wider, before giving up.
- The first screen has no Glyph example on live data. (The demo still sells Glyph: type it in, or keep the saved run.)
- The graph stays beside Pipeline too.
- The first round of the search is word for word as before, so the saved Glyph run still replays.
- 60 checks pass. The wider search has not run against the live services.

**Need.**
- `[open]` Yoon Woo: pull, `npm run dev`, try Dockline again. If it fails, send the new message (and open the Agents bar for the red lines).
- `[open]` Skylar: nothing changes in the demo script except that the Pipeline section now has the graph beside it.

## Nov 24, 04:00. Yoon Woo's Claude: logos in place of the white circles

**Why.** Yoon Woo, 03:30: "can you get the public photos of the schools instead of white circles?"

**Done (on `main`).** A company's disc on the graph, and its picture on the profile card, show the icon its own website publishes. A school with a one-word name ("UCLA") is tried as `name.edu`. No icon found: white, as before. Sample data shows none (its sites are not real). People keep their initials. 58 checks pass. Checked with stand-in pictures only: the real service could not be reached from where this was built.

**03:40, a crash and its fix.** On live data the graph threw "radius is negative" as soon as a cached logo arrived (his screenshot). Fixed in `e9d3d7c`; pull again.

**Need.**
- `[open]` Yoon Woo: `git pull`, `npm run clean`, `npm run dev`, then a live search, and say whether the logos look right (size, any wrong one).

## Nov 24, 03:50. Yoon Woo's Claude: a menu, a setting for the AI, keep or delete per claim (and a deep look, undone)

**Why.** Yoon Woo, 03:11 and 03:17: a setting for "how much is made up in the email by the AI"; a hamburger menu that slides in from the left with Target, Leads, Approve, Pipeline in it; "delete claims separately, what if someone wants to keep something"; and "the darker purple and some sort of blue that matches, a very rich vibe". At 03:24: "go back that's weird"; asked which look, he chose the light blue into purple.

**Done (on `main`).**
- **Menu.** The tab row is gone. The button at the top left (or the section name beside "Connet") slides a menu in from the left: the four sections and Settings.
- **Setting: "How much may the AI add on its own?"** Nothing (facts only; what is still unbacked is cut before you see it), A little (the default, as before), More (a sentence or two of its own pitch, marked for you). A number in no source is flagged at every setting. Applies to drafts written from then on.
- **Each unbacked claim has its own Keep and Delete.** Kept is shown as "Kept by you", never as backed, and is in the audit trail.
- **The look is the light blue into purple of the 03:20 entry.** The deep version was built (commit `d39a81d`) and reverted the same half hour at his word. Don't darken it again unless he asks.
- 55 checks pass. Checked in a browser on sample data only. "Nothing" and "More" have not been run on the live model yet.
- All of it is written up in `CLAUDE.md`.

**Need.**
- `[open]` Yoon Woo: `git pull`, `npm run clean` (or the old colors stay), `npm run dev`. Then try the setting on live data: set it, click Draft on a lead, look at the draft under Approve.
- `[open]` Skylar: the video should show the light blue-into-purple look and the menu. `docs/DEMO.md` now says "Menu, Target" and so on where it said "Target tab", and at 1:48 "Delete on one and Keep on another".

## Nov 24, 03:20. Yoon Woo's Claude: the whole app is blue into purple

**Why.** Yoon Woo, 02:56: "no like the whole thing make it peachy color" (peach had been made the accent only). Then at 03:02, before the peach version was pushed: "try purple and like a matching blue kind of vibe. Make sure it's appealing to the eyes".

**Done (on `main`).** No black anywhere now.
- One soft field behind the window, sky blue on the left into violet on the right. In "Your net" it turns purple all over (like Glyph's field changing with its mode).
- The work sits on white sheets. Deep indigo for text, the main button and the selected tab; violet for what is live; amber for what waits for you; scores still green, amber, red.
- The graph is drawn on the field: white discs for companies, dark dots for people, violet diamonds for reasons to write, white for the way in, the moving dots and the "draft waiting" ring.
- Only colors changed. Layout, words and behavior are as in the 03:00 entry. 51 checks pass. Checked in a browser on sample data only.
- The look is written up in `CLAUDE.md` ("The look: blue into purple").

**Need.**
- `[done]` Yoon Woo: `git pull`, `npm run clean`, `npm run dev` (superseded by the 03:45 entry).
- `[done]` Skylar: the video should show this look, not the black or peach one (superseded by the 03:45 entry). `docs/DEMO.md` at 1:38 now says "dashed white ring" where it said "yellow ring".

## Nov 24, 03:00. Yoon Woo's Claude: peach, scores out of 100, and a draft that shows what to delete

**Done (on `main`), all at Yoon Woo's request.**
- **The accent is Glyph's peach** (it was ice blue). "Waiting for you" is yellow now, so the two are not mistaken.
- **The match score reads "49/100"** and is green from 70, yellow from 45, red below.
- **The Approve card is two columns again**, nothing folded. A sentence that makes a claim nothing backs is struck out in red in the message, with one "Delete them" button; what the security check added is green. The long reviewer note is gone.
- LinkedIn photos in place of initials: not possible (no public way to fetch them, and scraping them is against LinkedIn's terms). Initials stay.
- 51 checks pass. Checked in a browser on sample data only.

**Need.**
- `[open]` Yoon Woo: `git pull`, `npm run clean`, `npm run dev`.
- `[done]` Skylar: the video should show the peach look (superseded by the 03:20 entry). One click changed in `docs/DEMO.md` at 1:48 (no more "Show proof").

## Nov 24, 02:40. Yoon Woo's Claude: every screen cut down

**Why.** Yoon Woo, looking at the profile card on live data: "Still too much going on", "it'll just make the judges get overwhelmed".

**Done (on `main`).** Each screen now opens on the few things that decide what to do; the rest is folded, one click away.
- **Profile card:** one column. Who to write to, why now, the way in. Folded: other people, why it scored, more proof.
- **Leads:** a row is a person, one line on why now, one button.
- **Approve:** the message, one line on what the second agent made of it, three buttons. "Show proof" opens the rest.
- **Above the graph:** the switch and one plain line of marks. The counts and captions are gone.
- 46 checks pass. Checked in a browser on sample data only.

**Need.**
- `[open]` Yoon Woo: `git pull`, `npm run clean`, `npm run dev`. Say which screen still feels busy.
- `[open]` Skylar: two clicks changed in `docs/DEMO.md`: at 1:20 open "Why it scored" in the card; at 1:48 click "Show proof" on the Summit Prep draft.

## Nov 24, 02:30. Yoon Woo's Claude: two nets, and a search that ran out of credits said nothing

**Done (on `main`).**
- **Two nets with a switch above the graph** (Yoon Woo's request: like Glyph's STEM | Humanities). **Glyph's net** is who the product is connected to. **Your net** puts the founder in the middle and everyone found on a ring: same school or employer, one introduction away, or no way in yet. Hover a person to read how they are tied. "Show on graph" for a warm way in turns to your net by itself.
- **Fixed:** with fewer than 5 credits, "Find my customers" did nothing and said nothing. It now says so on the start screen, with a "Top up 20 and search" button.
- 46 checks pass. Checked in a browser on sample data only.

**Need.**
- `[open]` Yoon Woo: `git pull`, `npm run clean`, `npm run dev`, and try the switch on your live run.
- `[open]` Skylar: `docs/DEMO.md` changed again at 1:20 and 1:38 (the graph turns to "Your net" for the warm way in, then back). The earlier `[open]` items still stand.

## Nov 24, 01:25. Yoon Woo's Claude: the name is Connet, and the screen is rebuilt to be easy

**What happened.** Yoon Woo ran it live (Gemini, Tavily, Hunter, Flexprice and Band all answer; Neo4j does not connect yet, the embedded graph stands in). He said it works but looks "complex and hard", like every other team's will, and asked for it to be much easier to use. He also renamed it: **Connet** (connect + network).

**Done (all on `main`).**
- **Name.** Connet everywhere it shows, with a new logo. Nobody needs to edit `.env.local`: the old value "Tact" there counts as not set. The repo name, the `TACT_*` settings and the Band agents' names stay as they are.
- **Leads tab** opens on one card, "Best to contact first", then the rest in order. One button per row. A line at the top of every tab says what to do next.
- **Tabs renamed** to the order of the work: Target, Leads, Approve, Pipeline (were Brief, Accounts, Approvals, Pipeline).
- **Profile card** for every company and person (click a row, or anything on the graph): score bars, who to write to, address, LinkedIn, why now, proof. Arrow keys flip through them.
- **Graph.** Dots run from Glyph to the person when a draft is written. An amber ring means a draft is waiting for approval. A clearer legend. A "Best first" flag.
- **"Enrich" is now "Find emails".** The agent drafts for the best three on its own (was five), so there are leads left to click **Draft** on.
- The agents' feed is one line until it is clicked open.
- 40 checks pass. Checked in a browser on sample data only. Yoon Woo has not seen it yet.

**Need.**
- `[open]` Yoon Woo: `git pull`, `npm run clean`, `npm run dev`. Say what still feels hard.
- `[open]` Yoon Woo: Neo4j. The username line in `.env.local` was doubled (`NEO4J_USERNAME=NEO4J_USERNAME=neo4j`); after fixing it, run `npm run doctor` once. If it still fails, leave it: the demo does not need it.
- `[open]` Skylar: `docs/DEMO.md` is rewritten for the new screen (new tab names, the profile card, a Draft click at 1:38, and "click the Agents bar open" at 0:20). Re-read it before recording. The video should say Connet.
- `[done]` The first live run, Band, and Gemini billing from the entries below.

## Nov 23, 23:48. Yoon Woo's Claude: the repo is public, setup commands

**Done.** The repo is live at https://github.com/yoonwoo-lee/tact-gtm. Two new commands: `npm run setup:flexprice` and `npm run setup:band` do the dashboard setup from one key each (see the README). 37 checks pass. Yoon Woo is collecting keys now.

**Need.**
- `[open]` Skylar: clone the repo, `npm install`, `npm run demo`. No keys needed. Then the items in the entry below.

## Nov 23, 23:12. Yoon Woo's Claude: live paths tested, replay

**Done.**
- The code that talks to Gemini, Tavily, Hunter, Flexprice and Band now runs in the tests against stand-ins that answer in each service's documented format (`tests/live.test.ts`). 33 checks pass. The real services are still untested.
- Rate limits are handled: a per-minute limit is waited out, a per-day limit moves to the next model.
- Replay: every live answer is saved on the machine; the same brief run again needs no network and says "Live data, replayed".
- The model is shown the paragraphs of a page that bear on the question, not its first 2,200 characters.
- The credit gate counts down even when the Flexprice wallet does not.

**Found.** One live run is about 35 model calls and 20 searches. A free Gemini key will probably not finish one.

**Need.**
- `[done]` Yoon Woo: turn on Gemini billing (the $5) before the first live run.
- `[open]` Skylar: for the video, sample data (`npm run demo`) still works with no keys. If Yoon Woo gets a live run done first, record from the replay instead: real companies look better.

## Nov 23, 22:53. Yoon Woo's Claude: first build

**What happened.** The organizer's email on Nov 23 named the problem statement: an AI go-to-market engine, not open "AI for productivity". Glyph does not answer it, so Yoon Woo asked for the engine to be built overnight. Pre-building is allowed. Glyph is the product it sells in the demo.

**What is here.** The whole loop: product intake, ICP with confidence, discovery with checked quotes, a knowledge graph (Neo4j when connected, embedded otherwise), enrichment, reviewed drafts, an approval queue, a pipeline board with analytics and an audit record, credit metering. It runs end to end on sample data with no keys. 20 checks pass.

**The look.** Black and grey with one ice-blue accent, at Yoon Woo's request at 22:40 (it started in Glyph's colors). See "The look" in `CLAUDE.md` before changing anything visual.

**What is not proven.** Nothing has been run against the live services yet. See "Status" in `CLAUDE.md`.

**For Skylar's side:**

- `[open]` Read `docs/DEMO.md` and rewrite the spoken lines in your own words. The order of clicks should stay: it follows the judging weights.
- `[open]` Record the 2 to 3 minute video on sample data: `npm install`, then `npm run demo`, open http://localhost:3000. No keys needed.
- `[open]` Read `docs/ARCHITECTURE.md` as a judge would and note anything unclear here.
- `[open]` The "who pays and why" answer for startup viability: buyer, price per result, why now. Three sentences for the pitch.
- `[open]` Both of you: finish the AWS Builder registration from the organizer's email ("CRITICAL STEP") and bring a physical ID.

**For Yoon Woo's side:**

- `[done]` First live run on the Mac: `npm run doctor`, then `npm run dev`.
- `[done]` Band: register four agents (Planner, Builder, Reviewer, Security), put their keys and the room id in `.env.local`.
