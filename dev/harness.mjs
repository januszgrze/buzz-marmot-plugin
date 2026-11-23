// Runs the real plugin/plugin.js headlessly: React 19 and jsdom from a
// buzz-app checkout, a mock plugin ctx whose `host.spawn` starts real `wn`
// processes, and a CLI "peer" account on the other side of each chat.
// Buzz's own components (people picker, composer, message rows, identity
// card) are stand-ins that record their props; the relay session is an
// in-memory event store that holds the 30315 bindings. The pieces and test
// groups live in dev/harness/.
//
//   node dev/harness.mjs [--boot-only]
//
// Env: BUZZ_APP (a buzz-app checkout with node_modules installed; default
// ../buzz-app next to this repository), HARNESS_ROOT (default
// ~/.buzz-marmot-dev/harness; replaces ~/.buzz-marmot), PEER_HOME
// (default ~/.buzz-marmot-dev/harness-peer; daemon and account are
// created on first use), VIEWER (fake Buzz pubkey hex).
import { BINDING_D, PEER_BUZZ, VIEWER, bootOnly, log } from "./harness/config.mjs";
import { cleanups, last, root, rows } from "./harness/buzz.mjs";
import { openNewChat, waitFor } from "./harness/assert.mjs";
import { events, publish } from "./harness/relay.mjs";
import { commands, ensurePeer } from "./harness/wn.mjs";
import { checkSectionMenu, shownRow } from "./harness/sidebar.mjs";
import { checkConversation } from "./harness/conversation.mjs";
import { checkOtherCommunity, checkTaggedInvite, checkUntaggedInvite } from "./harness/community.mjs";
import { checkUnread } from "./harness/unread.mjs";
import { checkCarol, checkNewChat } from "./harness/new-chat.mjs";

try {
  const peerId = bootOnly ? null : ensurePeer();
  if (peerId) {
    log("peer", peerId.npub);
    // The peer's Buzz identity published its binding.
    publish(PEER_BUZZ, { kind: 30315, content: JSON.stringify({ v: 1, account: peerId.id, npub: peerId.npub }), tags: [["d", BINDING_D]] });
  }
  const card = await waitFor("the Marmot ID card", () => document.querySelector("[data-testid=marmot-id-card]"), 180_000);
  const shownKey = card.querySelector("code").textContent;
  log("Marmot ID card:", card.textContent.slice(0, 60));
  const binding = await waitFor("the binding event", () =>
    events.find((e) => e.pubkey === VIEWER && e.kind === 30315 && e.tags.some((t) => t[0] === "d" && t[1] === BINDING_D)),
  );
  const bound = JSON.parse(binding.content);
  if (`${bound.npub.slice(0, 12)}…${bound.npub.slice(-6)}` !== shownKey) throw new Error("the card shows another Marmot key than the binding");
  log("binding published:", binding.content);
  log("sidebar rows:", JSON.stringify(rows().map(shownRow)));
  await checkSectionMenu(bound.npub);
  if (!bootOnly) {
    await waitFor("the New chat view", () => document.getElementById("marmot-new-chat-to") && last.composer?.channelId === "marmot:new");
    log("New chat view: To field + composer, composer label:", last.composer.label);

    const peerGroup = await checkTaggedInvite(bound);
    await checkConversation(peerGroup);

    log("New encrypted chat from the Encrypted section's action");
    await openNewChat();
    await checkUnread(peerGroup);
    const newGroup = await checkNewChat(peerGroup);
    await checkOtherCommunity(newGroup);
    await checkUntaggedInvite(bound, newGroup);
    await checkCarol(bound);
  }
  log("PASS");
} catch (error) {
  log("FAIL", error.message);
  process.exitCode = 1;
} finally {
  const sequence = [...new Set(commands.map((c) => c.replace(/[0-9a-f]{32,64}/g, "<id>").replace(/npub1\w+/g, "<npub>")))];
  log("distinct wn command shapes:\n  " + sequence.join("\n  "));
  for (const cleanup of cleanups) cleanup();
  root.unmount();
  setTimeout(() => process.exit(), 500);
}
