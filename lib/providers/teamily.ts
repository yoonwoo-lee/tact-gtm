// Optional: mirror a deal room into Teamily, the AI-native messenger, so the team can follow a
// deal from the app they already live in.
//
// Teamily's REST surface takes a message for an agent and gives each `user` its own conversation
// and memory, so one deal is one conversation there: a lead's room opening starts it, and
// everything said after lands in the same thread. Off unless the key and the agent id are set.
//
// Like every other integration here, it never throws and never stops a run: a failure leaves the
// deal room exactly as it is, and the connections panel says Teamily is local only.
import { config, modes } from "../config";

export let teamilyError: string | null = null;

/** One conversation per deal. Teamily keys a thread on this id, so it has to be stable. */
export const conversationFor = (leadId: string) => `deal-${leadId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60)}`;

/**
 * Say something about a deal in Teamily. Returns whether it arrived, and never throws.
 * `once` makes the call idempotent: Teamily drops a repeat of the same key, so a hot reload or a
 * retry cannot post the brief twice.
 */
export async function teamilyPost(leadId: string, text: string, once: string): Promise<boolean> {
  if (!modes().teamily) return false;
  try {
    const res = await fetch(`${config.teamilyHost}/agents/${config.teamilyAgentId}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.teamilyToken}`,
        "content-type": "application/json",
        "idempotency-key": once,
      },
      body: JSON.stringify({ input: text, user: conversationFor(leadId), wait_ms: 8000 }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    // 202 means the agent is still thinking. The message is in either way, which is all we want.
    if (!res.ok && res.status !== 202) throw new Error(`Teamily ${res.status}: ${(await res.text()).slice(0, 300)}`);
    teamilyError = null;
    console.log(`[teamily] posted to ${conversationFor(leadId)} (${res.status})`);
    return true;
  } catch (e) {
    teamilyError = e instanceof Error ? e.message : String(e);
    // Said out loud in the server log: a mirror that quietly does nothing is worse than one that
    // says why. The deal room itself is untouched either way.
    console.warn(`[teamily] ${teamilyError}`);
    return false;
  }
}
