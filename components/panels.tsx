"use client";
// The two panels the header opens, and the word for where the run's answers came from. The app
// at / and the dashboard at /home both show these: one wallet and one list of connections, or the
// two pages could tell a different story about the same run.
import { COSTS, type Workspace } from "@/lib/types";
import type { Act } from "./BriefTab";
import { Icon } from "./ui";

const EVENT_NAMES: Record<string, string> = {
  "discovery.run": "Search",
  "lead.enriched": "Emails found",
  "outreach.drafted": "Message drafted",
  "outreach.sent": "Message sent",
  "graph.query": "Graph query",
  "credits.topup": "Top-up",
};

export function CreditsPanel({ ws, act, busy }: { ws: Workspace; act: Act; busy: Set<string> }) {
  const c = ws.credits;
  const shown = c.balance;
  const usage = new Map<string, number>();
  for (const e of c.ledger) if (e.event !== "credits.topup") usage.set(e.event, (usage.get(e.event) || 0) + 1);
  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="text-[30px] font-extrabold leading-none">{shown}</div>
        <div className="text-soft pb-0.5">credits left</div>
      </div>
      <div className="text-faint text-[13px] mt-1">
        A search costs {COSTS["discovery.run"]}, finding emails at a company {COSTS["lead.enriched"]}, a draft {COSTS["outreach.drafted"]}. Paid steps stop when this reaches zero.
      </div>
      <div className="mt-3 grid gap-1 text-[14px]">
        {[...usage.entries()].map(([event, n]) => (
          <div key={event} className="flex justify-between">
            <span>{EVENT_NAMES[event] || event}</span>
            <span className="font-semibold">{n} metered</span>
          </div>
        ))}
        {usage.size === 0 && <div className="text-faint">Nothing metered yet.</div>}
      </div>
      <div className="rounded-xl bg-raise p-2.5 mt-3 text-[13px] leading-snug">
        {c.flexprice.configured ? (
          <>
            <span className="font-bold">Flexprice: </span>
            {c.flexprice.accepted} usage events accepted{c.flexprice.failed ? `, ${c.flexprice.failed} failed` : ""}.{" "}
            {c.flexprice.wallet == null
              ? "No wallet found for this customer, so the gate uses this app's own count."
              : c.flexprice.wallet > c.balance
                ? `The Flexprice wallet reads ${c.flexprice.wallet}: it is not being drawn down by these events yet, so the gate uses this app's own count.`
                : "The balance above follows the Flexprice wallet."}
            {c.flexprice.lastError && <div className="text-bad mt-1">{c.flexprice.lastError}</div>}
          </>
        ) : (
          <>
            <span className="font-bold">Local ledger. </span>Add FLEXPRICE_API_KEY to meter usage in Flexprice.
          </>
        )}
      </div>
      <button className="btn w-full mt-3" disabled={busy.has("topup")} onClick={() => act({ type: "topup", credits: 20 }, "topup")}>
        <Icon name="plus" />
        Top up 20 credits
      </button>
    </div>
  );
}

export function Connections({ ws }: { ws: Workspace }) {
  const m = ws.modes;
  /* Each row names the integration this product is built on, and then says what this particular
     run actually used it for. The two are not the same thing and must not be allowed to look the
     same: the keys decide the second, and with none set every lookup is answered from the sample
     workspace. Printing "Gemini" on a run that never called Gemini would make this panel — the one
     surface whose whole job is to say what was really wired up — the least trustworthy on the page. */
  const rows: { name: string; vendor: string; note: string; live: boolean }[] = [
    { name: "Model", vendor: "Gemini", note: "sample answers", live: m.llm !== "sample" },
    { name: "Web search", vendor: "Tavily", note: "sample pages", live: m.search !== "sample" },
    { name: "Contact data", vendor: "Hunter.io", note: "sample records", live: m.enrich !== "sample" },
    { name: "Knowledge graph", vendor: m.graph === "neo4j" ? "Neo4j" : "Embedded graph", note: "", live: m.graph === "neo4j" },
    { name: "Usage billing", vendor: "Flexprice", note: "local ledger", live: m.billing === "flexprice" },
    { name: "Agent room", vendor: "Band", note: "in this app only", live: !!m.band },
    { name: "Deal rooms", vendor: "Teamily", note: "in this app only", live: !!m.teamily },
    { name: "Sending", vendor: "Simulated", note: "nothing leaves this machine", live: false },
  ];
  return (
    <div className="grid gap-2 text-[14px]">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full flex-none" style={{ background: r.live ? "#17914F" : "#B9B3DE" }} />
          <span className="font-semibold w-[118px] flex-none">{r.name}</span>
          <span className="text-soft">
            {r.vendor}
            {!r.live && r.note ? <span className="text-faint"> &middot; {r.note} this run</span> : null}
          </span>
        </div>
      ))}
      {(ws.run.stats.replayed || 0) > 0 && (
        <div className="box p-2.5 text-[13px] leading-snug mt-1">
          <span className="font-bold">Replay. </span>
          {ws.run.stats.replayed} of this run&rsquo;s lookups were answered from copies saved on this machine earlier, so they cost nothing and needed no network. Run <span className="mono">npm run fresh</span> to fetch everything again.
        </div>
      )}
      <div className="text-faint text-[13px] mt-1">Keys live in .env.local. A missing key switches that one part to sample data.</div>
    </div>
  );
}

/** Where this run's answers came from, in the two or three words the chip has room for. */
export function dataLabel(ws: Workspace): { label: string; live: boolean } {
  const sample = ws.modes.llm === "sample" || ws.modes.search === "sample";
  const st = ws.run.stats;
  // Live answers saved earlier on this machine and read back: real data, but not fetched just now.
  const replayed = !sample && (st.replayed || 0) > 0 && (st.replayed || 0) >= (st.llmCalls + st.searches) / 2;
  return { label: sample ? "Sample data" : replayed ? "Live data, replayed" : "Live data", live: !sample };
}
