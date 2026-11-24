// Everything the rep can do after a run, as one endpoint: { type, ... }.
import { decideClaim, decideExpansion, decideMeeting, decideMessage, setAddress, draftLead, enrichLead, logReply, moveStage, scanJobs, setDomain, setFreedom, suppress, topUp } from "@/lib/pipeline";
import { completeTask, inviteClient } from "@/lib/dealroom";
import { store } from "@/lib/store";
import { STAGES, type Freedom, type Stage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  try {
    switch (body.type) {
      case "enrich":
        await enrichLead(str(body.leadId));
        break;
      case "draft":
        await draftLead(str(body.leadId), "rep", body.force === true);
        break;
      case "message":
        decideMessage(str(body.messageId), body.action as "approve" | "reject" | "edit", { subject: body.subject as string | undefined, body: body.body as string | undefined });
        break;
      case "claim":
        decideClaim(str(body.messageId), body.index === "all" ? "all" : Number(body.index), body.action as "delete" | "keep" | "unkeep");
        break;
      case "address":
        setAddress(str(body.messageId), str(body.email));
        break;
      case "meeting":
        decideMeeting(str(body.meetingId), body.action as "book" | "cancel", str(body.start) || undefined, Number(body.minutes) || undefined);
        break;
      case "settings":
        setFreedom(body.freedom as Freedom);
        break;
      case "stage":
        if (!STAGES.includes(body.stage as Stage)) throw new Error("Unknown stage");
        moveStage(str(body.leadId), body.stage as Stage);
        break;
      case "reply":
        if (str(body.text).trim().length < 2) throw new Error("Paste the reply text first");
        return Response.json({ ok: true, result: await logReply(str(body.leadId), str(body.text).slice(0, 4000)) });
      case "domain":
        setDomain(str(body.leadId), str(body.domain));
        break;
      case "expansion":
        await decideExpansion(str(body.id), body.action as "accept" | "dismiss", str(body.segment) || undefined);
        break;
      case "topup":
        await topUp(Math.max(1, Math.min(100, Number(body.credits) || 20)));
        break;
      case "scan":
        return Response.json({ ok: true, result: await scanJobs() });
      case "inviteClient":
        inviteClient(str(body.leadId));
        break;
      case "task":
        completeTask(str(body.leadId), str(body.taskId), body.done !== false);
        break;
      case "suppress":
        suppress(str(body.leadId));
        break;
      case "reset":
        store().state.product = null;
        store().reset();
        break;
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
