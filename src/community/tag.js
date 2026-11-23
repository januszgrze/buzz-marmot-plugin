// Community tags: normalizing relay URLs and reading the tag from a group description.
import { COMMUNITY_LINE } from "../shared/constants.js";

/** A community origin or relay URL as `wss://host[:port]` (`ws://` for a
 * plaintext relay), lowercase, default port and trailing slash dropped. */
export function normalizeCommunity(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (!/^(wss?|https?):$/.test(url.protocol) || !url.host) return null;
    const secure = url.protocol === "wss:" || url.protocol === "https:";
    return `${secure ? "wss" : "ws"}://${url.host}`;
  } catch {
    return null;
  }
}

export function chatCommunity(description) {
  const line = COMMUNITY_LINE.exec(description ?? "");
  return line ? normalizeCommunity(line[1]) : null;
}
