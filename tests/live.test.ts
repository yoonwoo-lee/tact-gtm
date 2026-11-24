// The live code paths, run against a fake internet.
//
// Every real service is replaced by a stand-in that answers in that service's own format
// (as its documentation describes it), including the awkward cases: a model the key cannot use,
// a refused setting, rate limits, a reply that is not JSON, a page that is mostly menu.
// What the stand-ins answer comes from the sample data, so the run must end in the same place
// as the sample run. This cannot prove the real services behave as documented, but it does run
// every line that talks to them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

delete process.env.TACT_SAMPLE;
process.env.TACT_DATA_DIR = ".data-test-live";
process.env.TACT_REPLAY_PACE_MS = "0";
process.env.GEMINI_API_KEY = "test-gemini";
process.env.GEMINI_MODELS = "gone-model,busy-model,good-model";
process.env.TAVILY_API_KEY = "test-tavily";
process.env.HUNTER_API_KEY = "test-hunter";
process.env.FLEXPRICE_API_KEY = "test-flexprice";
process.env.FLEXPRICE_CUSTOMER_ID = "tact-demo";
process.env.BAND_CHAT_ID = "room-1";
for (const a of ["PLANNER", "BUILDER", "REVIEWER", "SECURITY"]) process.env[`BAND_API_KEY_${a}`] = `band-${a.toLowerCase()}`;
delete process.env.NEO4J_URI;

fs.rmSync(".data-test-live", { recursive: true, force: true });

const FILLER = Array.from({ length: 14 }, (_, i) =>
  `Visitor information, part ${i + 1}. The front desk is open on weekdays and parking permits are issued each autumn. The cafeteria menu rotates weekly and the lost property box is emptied on Fridays, so please label coats and lunch boxes clearly before the term begins.`,
).join("\n\n");

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a full run through the live code paths", async (t) => {
  const { hooks } = await import("../lib/providers/hooks");
  const { sampleAnswer } = await import("../lib/sample/model");
  const { sampleSearch } = await import("../lib/sample/search");
  const { sampleDomain } = await import("../lib/sample/enrich");

  // What each prompt and each query was for, so the stand-ins can answer from the sample data.
  const asked = new Map<string, { task: string; input: unknown }>();
  const searched = new Map<string, Parameters<typeof sampleSearch>[1]>();
  hooks.llmCall = (c) => void asked.set(c.user, { task: c.task, input: c.input });
  hooks.searchCall = (q, h) => void searched.set(q, h);

  const seen = { gemini: [] as { model: string; body: Record<string, unknown>; key: string | null }[], tavily: 0, hunter: 0, events: [] as Record<string, unknown>[], band: [] as { path: string; key: string | null; body: Record<string, unknown> }[] };
  let busyCalls = 0;
  let goodCalls = 0;
  let brokeJsonOnce = false;

  const fake: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url.hostname === "generativelanguage.googleapis.com") {
      const model = url.pathname.split("/models/")[1].split(":")[0];
      seen.gemini.push({ model, body, key: headers.get("x-goog-api-key") });
      if (model === "gone-model") return json(404, { error: { code: 404, message: "models/gone-model is not found for API version v1beta", status: "NOT_FOUND" } });
      const limit = (quotaId: string, retryDelay: string) =>
        json(429, {
          error: {
            code: 429,
            message: "You exceeded your current quota, please check your plan and billing details.",
            status: "RESOURCE_EXHAUSTED",
            details: [
              { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId }] },
              { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
            ],
          },
        });
      if (model === "busy-model") {
        busyCalls += 1;
        return busyCalls === 1 ? limit("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "0.2s") : limit("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "34s");
      }
      // good-model
      const cfg = body.generationConfig as Record<string, unknown>;
      if (cfg.thinkingConfig) return json(400, { error: { code: 400, message: "Thinking budget is not supported for this model.", status: "INVALID_ARGUMENT" } });
      goodCalls += 1;
      if (goodCalls === 9) return limit("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "0.3s");
      const user = ((body.contents as { parts: { text: string }[] }[])[0].parts[0].text) as string;
      const call = asked.get(user);
      assert.ok(call, "the model was sent a prompt the pipeline never announced");
      if (call.task === "extract_people" && !brokeJsonOnce) {
        brokeJsonOnce = true;
        return json(200, { candidates: [{ content: { parts: [{ text: "Sure, here are the people I found:" }] }, finishReason: "STOP" }] });
      }
      const answer = JSON.stringify(sampleAnswer(call.task, call.input));
      const text = call.task === "icp" ? "```json\n" + answer + "\n```" : answer;
      return json(200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 1 } });
    }

    if (url.hostname === "api.tavily.com") {
      seen.tavily += 1;
      assert.equal(headers.get("authorization"), "Bearer test-tavily");
      const query = String(body.query);
      const hint = searched.get(query);
      assert.ok(hint, "a search went out that the pipeline never announced");
      const pages = sampleSearch(query, hint).slice(0, Number(body.max_results) + 2);
      return json(200, {
        query,
        results: pages.map((p, i) => ({
          url: p.url,
          title: p.title,
          // The engine's excerpt is the start of the page; the page itself is mostly things nobody asked about.
          content: p.text.slice(0, 150),
          raw_content: i % 2 === 0 ? `Home | About | Programs | Contact\n\n${FILLER}\n\n${p.text}\n\n${FILLER}\n\n© 2026. All rights reserved. Privacy policy.` : `Home | About | Contact\n${p.text}`,
          score: 0.9 - i * 0.05,
        })),
        response_time: 0.4,
      });
    }

    if (url.hostname === "api.hunter.io") {
      seen.hunter += 1;
      assert.equal(url.searchParams.get("api_key"), "test-hunter");
      const d = sampleDomain(url.searchParams.get("domain") || "");
      return json(200, {
        data: {
          domain: d.domain,
          organization: "Example Org",
          pattern: d.pattern,
          emails: d.emails.map((e) => ({
            value: e.email,
            type: "personal",
            confidence: e.confidence,
            first_name: e.firstName,
            last_name: e.lastName,
            position: e.position,
            seniority: e.seniority,
            linkedin: null,
            sources: [{ domain: d.domain, uri: e.sourceUrl }],
            verification: { date: "2026-11-01", status: e.status === "verified" ? "valid" : "accept_all" },
          })),
        },
        meta: { results: d.emails.length, limit: 10, offset: 0 },
      });
    }

    if (url.hostname === "us.api.flexprice.io") {
      assert.equal(headers.get("x-api-key"), "test-flexprice");
      if (url.pathname.endsWith("/events")) {
        seen.events.push(body);
        return json(202, { message: "Event accepted for processing", event_id: body.event_id });
      }
      if (url.pathname.endsWith("/customers/wallets")) {
        assert.equal(url.searchParams.get("lookup_key"), "tact-demo");
        return json(200, [{ id: "wallet_1", wallet_status: "active", credit_balance: "30", real_time_credit_balance: "30", currency: "usd" }]);
      }
      return json(200, { ok: true });
    }

    if (url.hostname === "app.band.ai") {
      if (url.pathname.endsWith("/participants")) {
        return json(200, {
          data: [
            { id: "a-planner", name: "Planner", type: "Agent" },
            { id: "a-builder", name: "Builder", type: "Agent" },
            { id: "a-reviewer", name: "Reviewer", type: "Agent" },
            { id: "a-security", name: "Security", type: "Agent" },
            { id: "u-1", name: "Yoon Woo", type: "User" },
          ],
        });
      }
      seen.band.push({ path: url.pathname, key: headers.get("x-api-key"), body });
      return json(201, { data: { id: `m${seen.band.length}` } });
    }

    throw new Error(`The test has no stand-in for ${url.href}`);
  };
  globalThis.fetch = fake;

  const { GLYPH_FOUNDER, GLYPH_PRODUCT } = await import("../lib/sample/data");
  const p = await import("../lib/pipeline");
  const { store } = await import("../lib/store");
  const s = store();
  await new Promise((r) => setTimeout(r, 50)); // let the first wallet read land
  s.reset();
  await p.runPipeline(GLYPH_PRODUCT, GLYPH_FOUNDER);
  await new Promise((r) => setTimeout(r, 300)); // usage events and room posts are sent without waiting
  const lead = (name: string) => s.state.leads.find((l) => l.company === name);
  const feed = () => s.state.activity.map((a) => a.text).join("\n");
  t.diagnostic(`one run: ${seen.gemini.filter((c) => c.model === "good-model").length} answered model calls, ${seen.tavily} searches, ${seen.hunter} Hunter lookups, ${seen.events.length} usage events`);

  await t.test("every part is on its live service, and the run finishes", () => {
    // Teamily is left unset here: this run proves the services a run depends on, and a deal
    // room mirrored into a messenger is not one of them. tests/teamily.test.ts covers it off.
    assert.deepEqual({ ...s.state.modes, graph: undefined, send: undefined }, { llm: "gemini", search: "tavily", enrich: "hunter", billing: "flexprice", band: true, teamily: false, graph: undefined, send: undefined });
    assert.equal(s.state.run.status, "done", s.state.run.error || feed());
  });

  await t.test("it ends where the sample run ends: same accounts, same drop, same warm path", () => {
    assert.ok(lead("Brightpath Learning Centers"), feed());
    assert.ok(lead("Summit Prep Academy"));
    assert.equal(lead("Atlas STEM Labs"), undefined);
    assert.equal(s.state.run.stats.companiesDropped, 1);
    const b = lead("Brightpath Learning Centers")!;
    assert.equal(b.warmPaths[0]?.kind, "shared_school");
    assert.equal(b.score.tier, "A");
    for (const l of s.state.leads) {
      for (const e of l.evidence) assert.equal(e.verified, true);
      for (const sig of l.signals) assert.equal(sig.evidence.verified, true);
    }
  });

  await t.test("search: pages come from Tavily, and the passages that matter survive the menu and the filler", () => {
    const sources = Object.values(s.state.sources);
    assert.ok(sources.length > 5);
    assert.ok(sources.every((x) => x.provider === "tavily" || x.provider === "hunter"));
    assert.ok(sources.filter((x) => x.provider === "tavily").length > 5);
    assert.ok(sources.every((x) => x.text.length <= 3200));
    const hiring = sources.find((x) => /hiring 60 part-time math tutors/.test(x.text));
    assert.ok(hiring, "the paragraph with the buying signal was cut from a long page");
  });

  await t.test("model: asks with the key and JSON mode, drops a model the key cannot use, retries without a refused setting and after a non-JSON reply", () => {
    assert.ok(seen.gemini.every((c) => c.key === "test-gemini"));
    assert.ok(seen.gemini.every((c) => (c.body.generationConfig as Record<string, unknown>).responseMimeType === "application/json"));
    assert.equal(seen.gemini.filter((c) => c.model === "gone-model").length, 1);
    assert.equal(seen.gemini.filter((c) => c.model === "good-model" && (c.body.generationConfig as Record<string, unknown>).thinkingConfig).length, 1);
    assert.equal(brokeJsonOnce, true);
    assert.ok(lead("Brightpath Learning Centers")!.contacts.length > 0, "the people step did not recover from a reply that was not JSON");
  });

  await t.test("rate limits: a per-minute limit is waited out, a daily limit retires the model, and the feed says so", () => {
    assert.equal(busyCalls, 2);
    assert.match(feed(), /busy-model is out of its free quota for today/);
    assert.match(feed(), /asked us to slow down/);
    assert.equal(s.state.activity.filter((a) => a.kind === "error").length, 0, feed());
  });

  await t.test("enrichment: Hunter's records become contacts with their verification status", () => {
    assert.ok(seen.hunter >= 1);
    const maya = lead("Brightpath Learning Centers")!.contacts.find((c) => c.name === "Maya Okafor")!;
    assert.equal(maya.email, "maya.okafor@brightpath.example");
    assert.equal(maya.emailStatus, "verified");
  });

  await t.test("the reviewer still stops the invented statistic", () => {
    const m = s.state.messages.find((x) => x.leadId === lead("Summit Prep Academy")!.id)!;
    assert.equal(m.review.verdict, "revised");
    assert.equal(/30%/.test(m.body), false);
  });

  await t.test("metering: each paid step is a Flexprice event for the customer, and the gate reads the wallet", () => {
    const names = seen.events.map((e) => e.event_name);
    assert.ok(names.includes("discovery.run") && names.includes("lead.enriched") && names.includes("outreach.drafted") && names.includes("graph.query"), names.join(","));
    assert.ok(seen.events.every((e) => e.external_customer_id === "tact-demo" && typeof e.event_id === "string" && e.source === "tact"));
    assert.equal(new Set(seen.events.map((e) => e.event_id)).size, seen.events.length, "two events share an id");
    const fp = s.state.credits.flexprice;
    assert.equal(fp.failed, 0, fp.lastError || "");
    assert.equal(fp.accepted, seen.events.length);
    const spent = s.state.credits.ledger.reduce((sum, e) => sum - Math.min(0, e.credits), 0);
    // This stand-in wallet never moves (events with no price attached). The gate must still count down.
    assert.equal(fp.wallet, 30);
    assert.equal(s.available(), 30 - spent);
  });

  await t.test("Band: hand-offs are posted as messages that mention the receiving agent, each agent with its own key", () => {
    const messages = seen.band.filter((b) => b.path.endsWith("/messages"));
    const toReviewer = messages.find((m) => String((m.body.message as { content: string }).content).startsWith("@Reviewer"));
    assert.ok(toReviewer, "no message to the reviewer");
    assert.deepEqual((toReviewer.body.message as { mentions: unknown[] }).mentions, [{ id: "a-reviewer", name: "Reviewer" }]);
    assert.equal(toReviewer.key, "band-builder");
    assert.ok(messages.some((m) => String((m.body.message as { content: string }).content).startsWith("@Yoon Woo")), "nothing was addressed to the person");
    assert.ok(seen.band.some((b) => b.path.endsWith("/events")));
    assert.ok(seen.band.every((b) => b.path.startsWith("/api/v1/agent/chats/room-1/")));
  });

  await t.test("replay: the same brief again touches no service, and says so", async () => {
    const before = { gemini: seen.gemini.length, tavily: seen.tavily, hunter: seen.hunter };
    const names = s.state.leads.map((l) => l.company).sort();
    const drafts = s.state.messages.map((m) => m.subject).sort();
    // Three replays with uneven pauses, so answers arrive in a different order each time:
    // a replay must not depend on the order in which parallel lookups happened to finish.
    const { config } = await import("../lib/config");
    for (const pace of [0, 12, 30]) {
      config.replayPaceMs = pace;
      await p.runPipeline(GLYPH_PRODUCT, GLYPH_FOUNDER);
      assert.equal(s.state.run.status, "done", s.state.run.error || "");
      assert.deepEqual({ gemini: seen.gemini.length, tavily: seen.tavily, hunter: seen.hunter }, before, `a replay at pace ${pace} went to the network`);
      assert.deepEqual(s.state.leads.map((l) => l.company).sort(), names);
      assert.deepEqual(s.state.messages.map((m) => m.subject).sort(), drafts);
      s.topUp(40);
    }
    const st = s.state.run.stats;
    assert.ok(st.replayed >= st.llmCalls + st.searches, `${st.replayed} replayed of ${st.llmCalls} + ${st.searches}`);
    assert.match(feed(), /answered from saved copies/);
  });

  fs.rmSync(".data-test-live", { recursive: true, force: true });
});

test("what a 429 from Gemini says", async () => {
  const { readQuota } = await import("../lib/providers/llm");
  const body = (quotaId: string, retryDelay: string) =>
    JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] } });
  assert.deepEqual(readQuota(body("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "17s")), { daily: false, waitMs: 17000 });
  // A daily limit also carries a short retry delay, which would only fail again: the quota id decides.
  assert.deepEqual(readQuota(body("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "34s")), { daily: true, waitMs: 34000 });
  assert.deepEqual(readQuota('{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}'), { daily: false, waitMs: null });
  assert.deepEqual(readQuota("limit: 20, model: gemini\nPlease retry in 45.06576809s."), { daily: false, waitMs: 45066 });
});

test("the passages kept from a long page are the ones about the question, word for word", async () => {
  const { bestPassages } = await import("../lib/passages");
  const fact = "Northwind Tutoring said on Tuesday it is hiring 40 reading tutors ahead of the spring term. The chain now runs 18 centers across Ohio.";
  const page = `Home\nAbout us\nPrograms\nContact\n\n${FILLER}\n\n${fact}\n\n${FILLER}`;
  const kept = bestPassages(page, "Northwind Tutoring hiring OR funding OR expansion", 1200);
  assert.ok(kept.length <= 1200);
  assert.ok(kept.includes(fact), kept);
  assert.equal(bestPassages("Short page. Nothing to cut.", "anything", 1200), "Short page. Nothing to cut.");
});

test("page text: a link keeps its words and loses its address, so a quote across it still matches", async () => {
  const { plainText, shownText } = await import("../lib/providers/search");
  const { quoteInText } = await import("../lib/verify");
  const md = "## News\n\n**Northwind Tutoring** is [hiring 40 reading tutors](https://northwind.example/jobs?id=1_(a)) ahead of the *spring term*. ![logo](https://x.example/l.png)";
  assert.equal(plainText(md).includes("https://"), false);
  const shown = shownText("", md, "Northwind Tutoring hiring");
  assert.equal(quoteInText("Northwind Tutoring is hiring 40 reading tutors ahead of the spring term", shown), true);
});
