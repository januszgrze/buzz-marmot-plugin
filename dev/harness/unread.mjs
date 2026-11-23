// Unread is incoming-only, shown like a DM row, filtered by Unreads, and
// cleared by viewing.
import { log, sleep } from "./config.mjs";
import { openRow, rows, sections } from "./buzz.mjs";
import { click, text, waitFor } from "./assert.mjs";
import { drawnRow, menu, unreadRow } from "./sidebar.mjs";
import { peer } from "./wn.mjs";

/** Unread is incoming-only, shown like a DM row, filtered by Unreads, and cleared by viewing. */
export async function checkUnread(groupId) {
  await sleep(3_000);
  if (unreadRow(groupId)) throw new Error("the plugin's own message marked its chat unread");
  peer("messages", "send", "--group", groupId, "are you still there?");
  await waitFor("the row to turn unread", () => unreadRow(groupId));
  const shown = await waitFor("the unread dot and name", () => {
    const row = drawnRow(groupId);
    return row.dot && row.last && row.bold && row.ink && row;
  }, 5_000);
  if (rows().find((row) => row.id === groupId)?.count !== undefined) throw new Error("unread rows still show a count");
  log("unread row:", JSON.stringify(shown));

  const more = sections[0].actions.find((action) => action.id === "more");
  const header = document.createElement("div");
  header.setAttribute("data-sidebar-section", "");
  header.innerHTML = `<button aria-label="${more.label}"></button>`;
  document.body.append(header);
  const filterTo = async (label) => {
    await more.onSelect();
    click(menu("More actions for Encrypted messages").querySelectorAll("[role^=menuitem]")[0]);
    click([...menu("Filter Encrypted messages").querySelectorAll("[role^=menuitem]")].find((el) => el.textContent === label));
    await waitFor("the menu to close", () => !menu("More actions for Encrypted messages"), 5_000);
  };
  await filterTo("Unreads");
  if (!rows().some((row) => row.id === groupId)) throw new Error("Unreads hides an unread chat");
  await filterTo("All");
  header.remove();

  openRow(groupId);
  await waitFor("the chat to open", () => text().includes("are you still there?"));
  await waitFor("viewing to clear unread", () => !unreadRow(groupId), 5_000);
  await waitFor("the dot and name emphasis to clear", () => {
    const row = drawnRow(groupId);
    return !row.dot && !row.bold && !row.ink;
  }, 5_000);
  await sleep(3_000);
  if (unreadRow(groupId)) throw new Error("reloading chats from wn brought unread back");
  log("viewing cleared the dot and name emphasis; wn kept the read marker");
}
