// Showing Marmot members as Buzz people: names, chat titles, avatars.
import { HEX_KEY } from "../shared/constants.js";
import { shortKey } from "../shared/format.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createNames(env) {

  // ---- people ---------------------------------------------------------------

  /** A Marmot member as a Buzz person when a binding names them. */
  const buzzOf = (state, member) => state.directory[member] ?? member;

  function personName(profiles, pubkey) {
    return profiles.get(pubkey)?.name?.trim() || shortKey(pubkey);
  }

  /** Like a Buzz DM: the other people's names, else the group's own name. */
  function chatTitle(state, chat, profiles) {
    const others = state.members[chat.id];
    if (!others?.length) return chat.name;
    return others
      .map((member) => {
        const pubkey = buzzOf(state, member);
        return HEX_KEY.test(pubkey) && profiles.get(pubkey)?.name?.trim()
          ? profiles.get(pubkey).name.trim()
          : null;
      })
      .map((name, index) => name ?? (index === 0 ? chat.name : null))
      .filter(Boolean)
      .join(", ");
  }

  const avatarSrc = (relay, picture) => {
    if (typeof picture !== "string" || !picture) return undefined;
    if (picture.startsWith("data:")) return picture;
    try {
      return relay?.media?.(picture, "small");
    } catch {
      return undefined;
    }
  };
  return { buzzOf, personName, chatTitle, avatarSrc };
}
