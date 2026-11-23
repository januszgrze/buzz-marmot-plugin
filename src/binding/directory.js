// Publishing this identity's binding and looking up others' (kind 30315).
import { newestBindings } from "./events.js";
import { BINDING_D, BINDING_KIND, DIRECTORY_LIMIT } from "../shared/constants.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createBinding(env) {
  const { store, relaySession, viewer } = env;
  let boundFor = null;
  const resetBinding = () => {
    boundFor = null;
  };
  /** Publishes this identity's binding unless the relay already has it. */
  async function ensureBinding() {
    const relay = relaySession();
    const account = store.get().account;
    const buzz = viewer();
    if (!relay || !account || !buzz) return;
    const key = `${buzz}:${account.id}:${relay.scope ?? ""}`;
    if (boundFor === key) return;
    boundFor = key;
    if (
      typeof relay.readRemote !== "function" ||
      !relay.outbox?.supports?.(BINDING_KIND)
    ) {
      store.set({ binding: "unsupported", bindingError: null });
      return;
    }
    try {
      const current = newestBindings(
        await relay.readRemote([
          { kinds: [BINDING_KIND], authors: [buzz], "#d": [BINDING_D], limit: 5 },
        ]),
      ).get(buzz);
      if (current?.account !== account.id)
        relay.outbox.send({
          kind: BINDING_KIND,
          content: JSON.stringify({
            v: 1,
            account: account.id,
            npub: account.npub,
          }),
          tags: [
            ["d", BINDING_D],
            ["alt", "Marmot encrypted chats key for this Buzz identity"],
          ],
        });
      store.set({ binding: "published", bindingError: null });
    } catch (error) {
      boundFor = null;
      store.set({
        binding: "failed",
        bindingError: String(error?.message ?? error),
      });
    }
  }

  /** Every published binding in this community: Marmot key -> Buzz person.
   * A Marmot key claimed by two people names neither. */
  async function loadDirectory() {
    const relay = relaySession();
    if (typeof relay?.readRemote !== "function") return;
    try {
      const events = await relay.readRemote([
        { kinds: [BINDING_KIND], "#d": [BINDING_D], limit: DIRECTORY_LIMIT },
      ]);
      const directory = {};
      const claimed = new Set();
      for (const [buzz, found] of newestBindings(events)) {
        if (claimed.has(found.account)) delete directory[found.account];
        else directory[found.account] = buzz;
        claimed.add(found.account);
      }
      store.set({ directory });
    } catch {}
  }

  /** Marmot npubs for picked Buzz people; names everyone without one. */
  async function lookupBindings(pubkeys) {
    const relay = relaySession();
    if (typeof relay?.readRemote !== "function")
      return { error: "Buzz is not connected yet." };
    const found = newestBindings(
      (
        await relay.readRemote([
          {
            kinds: [BINDING_KIND],
            authors: pubkeys,
            "#d": [BINDING_D],
            limit: pubkeys.length * 4,
          },
        ])
      ).filter((event) => pubkeys.includes(event.pubkey)),
    );
    const missing = pubkeys.filter((pubkey) => !found.has(pubkey));
    return {
      npubs: pubkeys.flatMap((pubkey) => found.get(pubkey)?.npub ?? []),
      accounts: pubkeys.flatMap((pubkey) => found.get(pubkey)?.account ?? []),
      missing,
    };
  }
  return { resetBinding, ensureBinding, loadDirectory, lookupBindings };
}
