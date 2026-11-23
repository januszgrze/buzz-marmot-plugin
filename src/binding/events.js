// Kind 30315 binding events: parsing and picking the newest per Buzz author.
import { BINDING_D, BINDING_KIND, HEX_KEY, NPUB } from "../shared/constants.js";

/** A binding event's Marmot account, or null when it is not one. */
export function parseBinding(event) {
  if (
    event?.kind !== BINDING_KIND ||
    !event.tags?.some((tag) => tag[0] === "d" && tag[1] === BINDING_D)
  )
    return null;
  try {
    const body = JSON.parse(event.content);
    if (HEX_KEY.test(body?.account) && NPUB.test(body?.npub))
      return { account: body.account, npub: body.npub };
  } catch {}
  return null;
}

/** The newest binding per Buzz author. */
export function newestBindings(events) {
  const newest = new Map();
  for (const event of events ?? []) {
    const binding = parseBinding(event);
    if (!binding || !HEX_KEY.test(event.pubkey ?? "")) continue;
    const old = newest.get(event.pubkey);
    if (!old || event.created_at > old.at)
      newest.set(event.pubkey, { ...binding, at: event.created_at });
  }
  return newest;
}
