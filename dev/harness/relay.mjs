// The in-memory Buzz relay session: an event store holding the 30315
// bindings, profiles, and stock's DM people directory.
import { CAROL_BUZZ, PEER_BUZZ, UNBOUND_BUZZ, VIEWER, require } from "./config.mjs";

export const events = [];
let eventId = 0;
const matches = (filter, event) =>
  (!filter.kinds || filter.kinds.includes(event.kind)) &&
  (!filter.authors || filter.authors.includes(event.pubkey)) &&
  Object.entries(filter)
    .filter(([key]) => key.startsWith("#"))
    .every(([key, values]) => event.tags.some((tag) => tag[0] === key.slice(1) && values.includes(tag[1])));
/** Stores an event as if `pubkey` had published it; returns its id. */
export const publish = (pubkey, input) => {
  const event = { id: (++eventId).toString(16).padStart(64, "0"), pubkey, created_at: Math.floor(Date.now() / 1000) + eventId, sig: "", ...input };
  events.push(event);
  return event.id;
};
const profiles = new Map([
  [VIEWER, { name: "Harness" }],
  [PEER_BUZZ, { name: "Peer" }],
  [UNBOUND_BUZZ, { name: "Nobody" }],
  [CAROL_BUZZ, { name: "Carol" }],
]);
export const nip19 = require("nostr-tools/nip19");
export const { generateSecretKey, getPublicKey } = require("nostr-tools/pure");
/** main's typedPublicKey: an exact 64-hex key or npub (with or without `nostr:`). */
function typedPublicKey(text) {
  const value = text.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  try {
    const decoded = nip19.decode(value.replace(/^nostr:/i, ""));
    return decoded.type === "npub" ? decoded.data : undefined;
  } catch {
    return undefined;
  }
}
export const relaySession = {
  scope: "harness",
  viewer: VIEWER,
  async readRemote(filters) {
    if (!filters.every((f) => f.kinds?.length)) throw new Error("p-gate: kinds required");
    return events.filter((event) => filters.some((filter) => matches(filter, event)));
  },
  outbox: {
    supports: (kind) => kind === 30315,
    send: (input) => publish(VIEWER, input),
  },
  profiles: { subscribe: () => () => {}, snapshot: () => profiles, ensure: async () => {} },
  media: () => undefined,
  // Stock: the DM people directory the New message picker reads, with main's
  // argument checks (direct-messages.ts): pages start at 1, queries <= 100.
  directMessages: {
    available: true,
    async people(query, page) {
      if (query.length > 100 || !Number.isSafeInteger(page) || page < 1) throw new Error("Invalid people search.");
      const value = query.trim();
      const exact = typedPublicKey(value);
      const wanted = value.toLowerCase();
      return {
        people: [...profiles]
          .map(([pubkey, profile]) => ({ ...profile, pubkey }))
          .filter((p) => p.pubkey !== VIEWER && (exact ? p.pubkey === exact : p.name.toLowerCase().includes(wanted))),
        hasMore: false,
      };
    },
  },
};
