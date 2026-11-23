// The Encrypted messages sidebar section: its header, "…" menu, and rows
// drawn the way Buzz draws them.
import { log } from "./config.mjs";
import { createRoot, h } from "./dom.mjs";
import { rows, sections } from "./buzz.mjs";
import { click, waitFor } from "./assert.mjs";

export const menu = (label) => document.querySelector(`[role=menu][aria-label="${label}"]:not([data-ending-style])`);
const items = (el) => [...el.querySelectorAll("[role^=menuitem]")];
/** Where Buzz renders the section's actions: IconButtons inside the section. */
function menuAnchor() {
  const header = document.createElement("div");
  header.setAttribute("data-sidebar-section", "plugin:marmot.chats/encrypted");
  const trigger = document.createElement("button");
  trigger.setAttribute("aria-label", sections[0].actions[0].label);
  header.append(trigger);
  document.body.append(header);
  return { header, trigger };
}

/** Sets "… → Show untagged chats" through the menu. */
export async function setUntagged(on) {
  const { header } = menuAnchor();
  await sections[0].actions[0].onSelect();
  const item = items(menu("More actions for Encrypted messages")).find((el) => el.textContent === "Show untagged chats");
  if (item.getAttribute("role") !== "menuitemcheckbox") throw new Error(`Show untagged chats is a ${item.getAttribute("role")}`);
  if ((item.getAttribute("aria-checked") === "true") !== on) click(item);
  else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await waitFor("the menu to close", () => !menu("More actions for Encrypted messages"), 5_000);
  header.remove();
}

/** The section header (title, no icon, "…" + "+") and the plugin's "…" menu. */
export async function checkSectionMenu(npub) {
  const section = sections[0];
  const ids = section.actions.map((action) => action.id).join(",");
  if (section.title !== "Encrypted messages" || section.icon !== false || ids !== "more,new-chat")
    throw new Error(`unexpected section header: ${section.title} ${String(section.icon)} ${ids}`);
  const more = section.actions[0];
  const { header, trigger } = menuAnchor();
  const key = (el, name) => el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  let copied = null;
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value) => (copied = value) }, configurable: true });

  await more.onSelect();
  const root = menu("More actions for Encrypted messages");
  const shown = root && items(root).map((el) => `${el.textContent}${el.getAttribute("aria-checked") === "false" ? "☐" : ""}`);
  if (shown?.join("|") !== "Filter|Sort|Show untagged chats☐|Copy my Marmot ID" || trigger.getAttribute("aria-expanded") !== "true")
    throw new Error(`menu: ${shown}`);
  click(items(root)[0]);
  const filter = menu("Filter Encrypted messages");
  const choices = filter && items(filter).map((el) => `${el.textContent}${el.getAttribute("aria-checked") === "true" ? "✓" : ""}`);
  if (choices?.join("|") !== "All✓|Unreads") throw new Error(`filter: ${choices}`);
  key(filter, "ArrowLeft");
  if (menu("Filter Encrypted messages")) throw new Error("ArrowLeft left the filter submenu open");
  click(items(root)[0]);
  click(items(menu("Filter Encrypted messages")).find((el) => el.textContent === "Unreads"));
  await waitFor("the menu to close", () => !menu("More actions for Encrypted messages"));
  const unread = rows();
  if (!unread.every((row) => row.icon?.props?.unread || row.status || row.id === "new"))
    throw new Error(`Unreads still lists read chats: ${JSON.stringify(unread)}`);
  log("menu: Filter → Unreads leaves", unread.length, "rows");

  await more.onSelect();
  click(items(menu("More actions for Encrypted messages"))[0]);
  click(items(menu("Filter Encrypted messages")).find((el) => el.textContent === "All"));
  await more.onSelect();
  click(items(menu("More actions for Encrypted messages"))[1]);
  click(items(menu("Sort Encrypted messages")).find((el) => el.textContent === "A–Z"));
  const labels = rows().filter((row) => !row.status).map((row) => row.label);
  if (labels.join() !== [...labels].sort((a, b) => a.localeCompare(b)).join()) throw new Error(`A–Z: ${labels}`);
  await more.onSelect();
  click(items(menu("More actions for Encrypted messages"))[1]);
  click(items(menu("Sort Encrypted messages")).find((el) => el.textContent === "Recent"));

  await more.onSelect();
  key(menu("More actions for Encrypted messages"), "Escape");
  if (menu("More actions for Encrypted messages") || trigger.getAttribute("aria-expanded") !== "false")
    throw new Error("Escape left the menu open");
  await more.onSelect();
  click(items(menu("More actions for Encrypted messages")).at(-1));
  await waitFor("the copied Marmot ID", () => copied === npub);
  header.remove();
  log("menu: Filter, Sort, Escape and Copy my Marmot ID work; Show untagged chats is off");
}

export const unreadRow = (id) => rows().find((row) => row.id === id)?.icon?.props?.unread === true;
export const shownRow = (row) => [row.label, row.status ?? (row.icon?.props?.unread ? "unread" : "")];

/** Draws rows the way main's NavigationItem does, so the row icon can mark them. */
const sidebar = document.createElement("nav");
document.body.append(sidebar);
const sidebarRoot = createRoot(sidebar);
function drawSidebar() {
  sidebarRoot.render(
    rows().map((row) =>
      h(
        "button",
        { key: row.id, "data-row": row.id, className: "navigation-item" },
        row.icon,
        h("span", { className: "navigation-item-label" }, row.label),
      ),
    ),
  );
}
/** Row `id` as drawn: its unread dot (last, after the label) and name emphasis. */
export function drawnRow(id) {
  drawSidebar();
  const item = sidebar.querySelector(`[data-row="${id}"]`);
  const label = item?.querySelector(".navigation-item-label");
  return {
    dot: !!item?.querySelector(":scope > [data-marmot-unread]"),
    last: item?.lastElementChild?.hasAttribute("data-marmot-unread") ?? false,
    bold: label?.style.fontWeight === "var(--type-weight-semibold)",
    ink: label?.style.color === "var(--text-navigation-unread)",
  };
}
