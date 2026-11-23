// New encrypted chat and its To field: people lookups (names, Buzz keys,
// Marmot IDs, junk), people without a Marmot ID, and continuing a chat.
import { mkdirSync, rmSync } from "node:fs";
import { BINDING_D, CAROL_BUZZ, CAROL_HOME, LOCAL_RELAY, TAG_A, log, sleep } from "./config.mjs";
import { cleanups, last, navTarget, openRow, rowIds, rows } from "./buzz.mjs";
import { dom } from "./dom.mjs";
import { byText, click, openNewChat, setInput, submit, text, waitFor } from "./assert.mjs";
import { generateSecretKey, getPublicKey, nip19, publish } from "./relay.mjs";
import { setUntagged, shownRow } from "./sidebar.mjs";
import { carol, peer } from "./wn.mjs";

const typeTo = (value) => {
  const input = document.getElementById("marmot-new-chat-to");
  input.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true }));
  setInput(input, value);
};
/** Types (or pastes) into the To field and picks the option showing `label`. */
async function pickPerson(typed, label = typed) {
  typeTo(typed);
  const option = await waitFor(`${label} in the people list for ${typed.slice(0, 24)}`, () =>
    [...document.querySelectorAll("[role=option]")].find((el) => el.textContent.includes(label)),
  );
  option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
}
/** What the people list says for `typed` once it settles, with no options. */
async function emptyNote(typed) {
  typeTo(typed);
  await sleep(400);
  const note = await waitFor(`the people list to settle for ${typed.slice(0, 24)}`, () => {
    const list = document.getElementById("marmot-new-chat-to-people");
    const shown = list?.textContent ?? "";
    return list && !/^(Searching people|Looking up this key)/.test(shown) && shown;
  });
  if (document.querySelector("[role=option]")) throw new Error(`${typed.slice(0, 24)} listed people`);
  if (text().includes("Invalid people search")) throw new Error("the raw people search error is shown");
  return note;
}
const removePeople = () => {
  for (const button of document.querySelectorAll("button[aria-label^=Remove]")) click(button);
};

/** Someone without a Marmot ID is refused; a New chat to Peer continues
 * `peerGroup`, which the peer can read. Returns the chat it went to. */export async function checkNewChat(peerGroup) {
  await openNewChat();
  await pickPerson("Nobody");
  await waitFor("composer enabled", () => last.composer.submission.disabled === false);
  submit("should not send");
  const alert = await waitFor("the no-binding message", () => document.querySelector("[role=alert]")?.textContent);
  log("unbound person:", alert);
  if (!alert.includes("No Marmot ID yet for Nobody")) throw new Error("unexpected no-binding message");

  removePeople();
  await pickPerson("Peer");
  await waitFor("composer enabled", () => last.composer.submission.disabled === false && last.composer.label.includes("Peer"));
  // Like a DM, a New chat to people you already chat with here continues it.
  await waitFor("the continue note", () => document.querySelector("[data-testid=marmot-continuing]"), 10_000);
  submit("first encrypted message");
  await waitFor("the existing conversation", () => navTarget?.route?.params?.chat && text().includes("first encrypted message"), 120_000);
  const newGroup = navTarget.route.params.chat;
  if (newGroup !== peerGroup) throw new Error("New chat to Peer made another chat instead of continuing the tagged one");
  log("New chat to Peer continued the chat tagged for A");
  const firstSeen = await waitFor("the peer to read the first message", () =>
    peer("messages", "list", newGroup, "--limit", "5").messages.some((m) => m.plaintext === "first encrypted message"), 60_000,
  ).catch(() => false);
  log("peer reads the first message:", !!firstSeen);
  peer("messages", "send", "--group", newGroup, "peer joined");
  await waitFor("the peer's reply", () => text().includes("peer joined"));
  log("sidebar rows:", JSON.stringify(rows().map(shownRow)));
  if (!firstSeen) throw new Error("the peer could not read the message that created the chat");
  return newGroup;
}

/** The To field's lookups (names, Buzz keys, Marmot IDs, junk) and a third
 * person's chats: an untagged chat with them is never reused, a raw Marmot ID
 * invite is tagged for the community, and a New chat to them continues it. */
export async function checkCarol(bound) {
  mkdirSync(CAROL_HOME, { recursive: true, mode: 0o700 });
  cleanups.push(() => {
    try {
      carol("daemon", "stop");
    } catch {}
    rmSync(CAROL_HOME, { recursive: true, force: true });
  });
  carol("daemon", "start", "--discovery-relays", LOCAL_RELAY, "--default-account-relays", LOCAL_RELAY);
  await sleep(3_000);
  const me = carol("create-identity");
  if (!me.relay_lists?.complete) throw new Error("carol's identity has incomplete relay lists");
  log("carol", me.npub, "(no binding yet)");

  await openNewChat();
  const stranger = nip19.npubEncode(getPublicKey(generateSecretKey()));
  for (const [typed, expected] of [
    ["zzz nobody here", "No people found."],
    ["x".repeat(150), "No people found."],
    ["npub1abc", "Paste a whole npub or 64-character hex key."],
    [stranger, "No Marmot account found for this key."],
    [bound.npub, "That’s you."],
  ]) {
    const note = await emptyNote(typed);
    if (!note.includes(expected)) throw new Error(`To "${typed.slice(0, 24)}" says ${JSON.stringify(note)}, not ${expected}`);
  }
  log("To: junk, too long, half an npub, an unknown key and my own Marmot ID give friendly notes");

  const untagged = carol("groups", "create", `carol untagged ${Date.now() % 100000}`, bound.npub).group_id;
  await setUntagged(true);
  await waitFor("Carol's untagged invite", () => rowIds().includes(untagged), 240_000);
  openRow(untagged);
  await waitFor("the untagged invite", () => byText("button", "Accept"));
  click(byText("button", "Accept"));
  await waitFor("the untagged chat accepted", () => !byText("button", "Accept") && last.composer?.channelId === `marmot:${untagged}`, 60_000);
  await setUntagged(false);
  log("accepted Carol's untagged chat", untagged.slice(0, 16));

  await openNewChat();
  await pickPerson(` nostr:${me.npub} `, "Marmot ID npub1");
  await waitFor("composer enabled", () => last.composer.submission.disabled === false);
  if (document.querySelector("[data-testid=marmot-continuing]")) throw new Error("the untagged chat was offered for reuse");
  submit("hello raw marmot id");
  await waitFor("a new chat for the raw Marmot ID", () => {
    const chat = navTarget?.route?.params?.chat;
    return chat && chat !== untagged && text().includes("hello raw marmot id");
  }, 120_000);
  const tagged = navTarget.route.params.chat;
  const invite = await waitFor("Carol's invite", () => carol("groups", "invites").invites.find((i) => i.group_id === tagged), 120_000);
  if (invite.profile?.description !== TAG_A)
    throw new Error(`Carol's invite says ${JSON.stringify(invite.profile?.description)}, not the community A tag`);
  carol("groups", "accept", tagged);
  await waitFor("Carol to read it", () =>
    carol("messages", "list", tagged, "--limit", "5").messages.some((m) => m.plaintext === "hello raw marmot id"), 60_000);
  if (!rowIds().includes(tagged) || rowIds().includes(untagged)) throw new Error(`community A rows: ${rowIds()}`);
  log("raw Marmot ID: a new chat tagged for A (not the untagged one), Carol reads it");

  publish(CAROL_BUZZ, { kind: 30315, content: JSON.stringify({ v: 1, account: me.account_id, npub: me.npub }), tags: [["d", BINDING_D]] });
  await openNewChat();
  for (const typed of [nip19.npubEncode(CAROL_BUZZ), CAROL_BUZZ.toUpperCase(), `nostr:${me.npub}`]) {
    await pickPerson(typed, "Carol");
    removePeople();
  }
  await pickPerson("car", "Carol");
  await waitFor("the continue note", () => document.querySelector("[data-testid=marmot-continuing]"), 10_000);
  log("To: Carol's Buzz npub, hex, Marmot ID (via her binding) and name all find Carol");
  submit("still here");
  await waitFor("the message in the tagged chat", () => navTarget?.route?.params?.chat === tagged && text().includes("still here"), 60_000);
  await waitFor("Carol to read it", () =>
    carol("messages", "list", tagged, "--limit", "5").messages.some((m) => m.plaintext === "still here"), 60_000);
  await sleep(3_000);
  if (carol("groups", "invites").invites.length) throw new Error("continuing the chat invited Carol to another one");
  log("New chat to Carol continues the chat tagged for A");
}
