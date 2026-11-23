// Community tagging: chats tagged for a community are listed in it only,
// the open tab follows a switch, and Show untagged chats shows the rest.
import { COMMUNITY_A, COMMUNITY_B, TAG_A, log } from "./config.mjs";
import { rowIds, rows, switchCommunity } from "./buzz.mjs";
import { text, waitFor } from "./assert.mjs";
import { setUntagged } from "./sidebar.mjs";
import { peer } from "./wn.mjs";

/** The peer invites us to a chat tagged for A; returns its group id. */
export async function checkTaggedInvite(bound) {
  const name = `peer invite ${Date.now() % 100000}`;
  log("peer creates", name);
  const created = peer("groups", "create", `--description=${TAG_A}`, name, bound.npub);
  const peerGroup = created.group_id;
  const started = Date.now();
  await waitFor("the invite in the sidebar", () => rows().some((r) => r.id === peerGroup && r.status === "Invite"), 240_000);
  log(`invite arrived after ${Math.round((Date.now() - started) / 1000)}s`);
  switchCommunity(COMMUNITY_B);
  if (rowIds().includes(peerGroup)) throw new Error("community B lists an invite tagged for community A");
  switchCommunity(COMMUNITY_A);
  if (!rowIds().includes(peerGroup)) throw new Error("switching back to community A did not list its invite");
  log("community: the invite tagged for A is listed in A only, and follows a switch at once");
  return peerGroup;
}

/** A's open chat `newGroup` in community B, with Show untagged chats off and on. */
export async function checkOtherCommunity(newGroup) {
  switchCommunity(COMMUNITY_B);
  if (rowIds().includes(newGroup)) throw new Error("community B lists the chat created in community A");
  await waitFor("the open chat to say it belongs to another community", () =>
    text().includes("belongs to another community") && text().includes("community-a.test"), 5_000);
  await setUntagged(true);
  if (!rowIds().includes(newGroup)) throw new Error("Show untagged chats did not list A's chat in community B");
  await waitFor("the conversation with Show untagged chats on", () => text().includes("peer joined"), 5_000);
  await setUntagged(false);
  if (rowIds().includes(newGroup)) throw new Error("turning Show untagged chats off kept A's chat in community B");
  switchCommunity(COMMUNITY_A);
  log("community: A's chat is hidden in B, shown in B with Show untagged chats, and the open tab follows");
}

/** An untagged invite is hidden by default; A's own chat `newGroup` stays. */
export async function checkUntaggedInvite(bound, newGroup) {
  const untagged = peer("groups", "create", `untagged ${Date.now() % 100000}`, bound.npub).group_id;
  await setUntagged(true);
  await waitFor("the untagged invite with Show untagged chats on", () => rowIds().includes(untagged), 240_000);
  await setUntagged(false);
  if (rowIds().includes(untagged)) throw new Error("an untagged invite is listed with Show untagged chats off");
  if (!rowIds().includes(newGroup)) throw new Error("A's own chat went missing in A");
  log("community: an untagged invite is hidden by default and shown with Show untagged chats");
}
