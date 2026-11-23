// Who a pasted key names, and existing chats with the same people.
import { shortKey } from "../shared/format.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createResolve(env) {
  const { store, relaySession, viewer, loadDirectory, lookupBindings } = env;

  const noMarmotId = (who) =>
    `No Marmot ID yet for ${who}. They need the Marmot chats plugin installed and Buzz open once, so it can publish their Marmot ID.`;

  /** `pubkey`'s Buzz profile from the community's people directory. */
  async function buzzPerson(pubkey, signal) {
    const relay = relaySession();
    try {
      const found = await relay?.directMessages?.people?.(pubkey, 1, signal);
      const person = found?.people?.find((p) => p.pubkey === pubkey);
      if (person) return { person, known: true };
    } catch {}
    const profile = relay?.profiles?.snapshot?.()?.get(pubkey);
    return { person: { ...profile, pubkey, name: profile?.name ?? "" }, known: !!profile };
  }

  /** Who a pasted key names: a Buzz person with a Marmot ID (by their Buzz
   * key, or by the Marmot ID their binding names), else a bare Marmot
   * account with a KeyPackage on the Marmot relays. `note` explains an empty
   * result. */
  async function resolveKey(key, signal) {
    const me = viewer();
    if (key === me || key === store.get().account?.id) return { people: [], note: "That’s you." };
    const bound = await lookupBindings([key]);
    if (bound.error) return { people: [], note: bound.error };
    if (bound.npubs.length) return { people: [(await buzzPerson(key, signal)).person] };
    await loadDirectory();
    const owner = store.get().directory[key];
    if (owner === me) return { people: [], note: "That’s you." };
    if (owner) return { people: [(await buzzPerson(owner, signal)).person] };
    const checked = (await env.session?.checkKey(key)) ?? { error: "Marmot is not ready yet." };
    if (checked.npub)
      return { people: [{ pubkey: key, marmot: checked.npub, name: `Marmot ID ${checked.npub.slice(0, 12)}…` }] };
    const buzz = await buzzPerson(key, signal);
    if (buzz.known) return { people: [], note: noMarmotId(buzz.person.name || shortKey(key)) };
    return {
      people: [],
      note: checked.error ? `Could not check this key: ${checked.error}` : "No Marmot account found for this key.",
    };
  }

  /** The active community's chat with exactly these other Marmot accounts:
   * like a DM, a New chat to the same people continues it. */
  function existingChat(accounts, community) {
    const state = store.get();
    const wanted = [...new Set(accounts)].sort().join();
    if (!wanted || !community) return null;
    const invited = new Set(state.invites.map((invite) => invite.id));
    return (
      state.chats.find(
        (chat) =>
          !chat.pending &&
          !invited.has(chat.id) &&
          chat.community === community &&
          [...new Set(state.members[chat.id] ?? [])].sort().join() === wanted,
      ) ?? null
    );
  }
  return { noMarmotId, buzzPerson, resolveKey, existingChat };
}
