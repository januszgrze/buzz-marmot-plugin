// The active Buzz community and which chats belong to it.
import { normalizeCommunity } from "./tag.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createCommunity(env) {
  const { ctx } = env;

  // `selected()` names a community before it connects, so a switch shows at once.
  const activeCommunity = () =>
    normalizeCommunity(ctx.relay.selected?.() ?? ctx.relay.snapshot().origin);

  /** Chats tagged for the active community; with "Show untagged chats", all. */
  const inView = (chat, community, untagged) =>
    untagged || (!!community && chat.community === community);
  return { activeCommunity, inView };
}
