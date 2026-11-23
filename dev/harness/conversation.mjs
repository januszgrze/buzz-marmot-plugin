// A conversation: accepting an invite, the header and its ⓘ popover, and
// messages both ways with the peer.
import { PEER_BUZZ, log, sleep } from "./config.mjs";
import { last, openRow, source } from "./buzz.mjs";
import { byText, click, submit, text, waitFor } from "./assert.mjs";
import { unreadRow } from "./sidebar.mjs";
import { peer } from "./wn.mjs";

/** The conversation header's ⓘ: DM header button markup and its popover. */
async function checkInfo() {
  const button = document.querySelector("header .panel-header-actions [data-testid=marmot-info] button");
  const attrs = button && ["data-icon-variant", "data-icon-size", "data-icon-shape", "aria-label", "title"].map((name) => button.getAttribute(name));
  if (attrs?.join() !== "ghost,toolbar,control,About encrypted messages,About encrypted messages")
    throw new Error(`info button: ${attrs}`);
  if (document.querySelector("[data-testid=marmot-identity] svg[data-lock], [data-testid=marmot-identity] [data-testid=marmot-encrypted]"))
    throw new Error("the header still shows a lock");
  const dialog = () => document.querySelector("[role=dialog].buzz-popover-popup:not([data-ending-style])");
  const gone = (what) => waitFor(what, () => !document.querySelector("[role=dialog].buzz-popover-popup"), 5_000);

  button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  click(button);
  const open = await waitFor("the info popover", dialog, 5_000);
  const title = open.querySelector("h2").textContent;
  if (title !== "Encrypted messages (experimental)" || button.getAttribute("aria-expanded") !== "true")
    throw new Error(`popover: ${title} ${button.getAttribute("aria-expanded")}`);
  if (!/MDK/.test(open.textContent) || !/Forward/.test(open.textContent) || !/Marmot relays, not the Buzz relay/.test(open.textContent))
    throw new Error(`popover copy: ${open.textContent}`);
  const repoUrl = /\b(?:const|var) PLUGIN_REPO_URL = "([^"]+)"/.exec(source)?.[1];
  if (!repoUrl || last.markdown?.content !== `[Contribute on GitHub](${repoUrl})`)
    throw new Error(`contribute link: ${last.markdown?.content}`);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await gone("Escape to close the popover");
  if (document.activeElement !== button || button.getAttribute("aria-expanded") !== "false")
    throw new Error("Escape did not return focus to the info button");

  click(button);
  await waitFor("the popover again", dialog, 5_000);
  document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  await gone("an outside click to close the popover");

  click(button);
  await waitFor("the popover once more", dialog, 5_000);
  button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  click(button);
  await gone("the info button to close the popover");
  log("info: ⓘ opens the popover; Escape, an outside click and the button close it");
}

/** Accepts the peer's invite `peerGroup`, then trades messages in it. */
export async function checkConversation(peerGroup) {
  openRow(peerGroup);
  await waitFor("the invite conversation", () => document.querySelector("[data-testid=marmot-identity]") && byText("button", "Accept"));
  click(byText("button", "Accept"));
  await waitFor("the accepted conversation", () => !byText("button", "Accept") && last.composer?.channelId === `marmot:${peerGroup}`);
  await waitFor("the header to name the peer", () => document.querySelector("header").textContent.includes("Peer"));
  log("accepted; header:", document.querySelector("header").textContent, "| composer:", last.composer.label);
  await checkInfo();

  peer("messages", "send", "--group", peerGroup, "hello from the CLI peer");
  const incoming = await waitFor("the live peer message", () =>
    [...document.querySelectorAll("[data-testid=message]")].find((m) => m.textContent === "hello from the CLI peer"),
  );
  await waitFor("the peer shown as its Buzz identity", () =>
    [...document.querySelectorAll("[data-testid=message]")].find((m) => m.textContent === "hello from the CLI peer")?.dataset.author === PEER_BUZZ,
  );
  log("live peer message arrived, authored by", incoming.dataset.author === PEER_BUZZ ? "Peer's Buzz identity" : incoming.dataset.author);
  await sleep(3_000);
  if (unreadRow(peerGroup)) throw new Error("a message in the open chat left its row unread");

  const keyBefore = last.composer.submission.draftKey;
  submit("hello back from the plugin");
  await waitFor("own message", () => text().includes("hello back from the plugin"));
  await waitFor("the composer to clear", () => last.composer.submission.draftKey !== keyBefore);
  await waitFor("peer to receive it", () => peer("messages", "list", peerGroup, "--limit", "5").messages.some((m) => m.plaintext === "hello back from the plugin"), 30_000);
  log("peer received the plugin's message; composer moved to a fresh draft");
}
