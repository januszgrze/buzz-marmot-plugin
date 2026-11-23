// Runs the real plugin/plugin.js headlessly: React 19 and jsdom from a
// buzz-app checkout, a mock plugin ctx whose `host.spawn` starts real `wn`
// processes, and a CLI "peer" account on the other side of each chat.
// Buzz's own components (people picker, composer, message rows, identity
// card) are stand-ins that record their props; the relay session is an
// in-memory event store that holds the 30315 bindings.
//
//   node dev/harness.mjs [--boot-only]
//
// Env: BUZZ_APP (a buzz-app checkout with node_modules installed; default
// ../buzz-app next to this repository), HARNESS_ROOT (default
// ~/.buzz-marmot-dev/harness; replaces ~/.buzz-marmot), PEER_HOME
// (default ~/.buzz-marmot-dev/harness-peer; daemon and account are
// created on first use), VIEWER (fake Buzz pubkey hex).
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const home = homedir();
const BUZZ_APP = process.env.BUZZ_APP ?? fileURLToPath(new URL("../../buzz-app", import.meta.url));
const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "~/.buzz-marmot-dev/harness";
const PEER_HOME = process.env.PEER_HOME ?? `${home}/.buzz-marmot-dev/harness-peer`;
const VIEWER = process.env.VIEWER ?? "ab".repeat(32);
const PEER_BUZZ = "cd".repeat(32);
const UNBOUND_BUZZ = "ef".repeat(32);
// A third person: a fresh headless wn account per run (so no chat with them
// exists yet), whose Buzz identity publishes its binding mid-run.
const CAROL_BUZZ = "c4".repeat(32);
const CAROL_HOME = `${home}/.buzz-marmot-dev/harness-carol-${Date.now()}`;
const BINDING_D = "marmot.chats:binding";
const LOCAL_RELAY = "ws://127.0.0.1:27777";
// Community origins as stock Buzz's `ctx.relay.selected()` spells them, and
// the tags the plugin writes for them.
const COMMUNITY_A = "https://community-a.test";
const COMMUNITY_B = "http://localhost:3999";
const TAG_A = "buzz-community/v1 wss://community-a.test";
const bootOnly = process.argv.includes("--boot-only");
const expand = (p) => (p.startsWith("~/") ? `${home}${p.slice(1)}` : p);

const require = createRequire(`${BUZZ_APP}/package.json`);
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><div id=root></div><div id=settings></div>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "Event", "MouseEvent", "KeyboardEvent", "Node", "MutationObserver"])
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
for (const key of ["requestAnimationFrame", "cancelAnimationFrame"])
  Object.defineProperty(globalThis, key, { value: dom.window[key].bind(dom.window), configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const React = require("react");
const { createRoot } = require("react-dom/client");
const h = React.createElement;

const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
const commands = [];

const host = {
  async spawn(id, { args = [], cwd, env = {}, onStdout, onStderr }) {
    if (id !== "wn") throw new Error(`undeclared process ${id}`);
    const dir = expand(cwd);
    mkdirSync(dir, { recursive: true });
    const childEnv = { ...process.env };
    for (const [k, v] of Object.entries(env)) v === null ? delete childEnv[k] : (childEnv[k] = v);
    for (const k of Object.keys(childEnv)) if (/^(BUZZ_|NOSTR_)/.test(k)) delete childEnv[k];
    commands.push(args.join(" "));
    const child = spawn("wn", args, { cwd: dir, env: childEnv, detached: true });
    child.stdout.setEncoding("utf8").on("data", (d) => onStdout?.(d));
    child.stderr.setEncoding("utf8").on("data", (d) => onStderr?.(d));
    const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
    const kill = async () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    };
    // Like the host: the process group dies when the process exits.
    exited.then(kill);
    child.stdin.on("error", () => {});
    return {
      write: async (data) => void child.stdin.write(data),
      end: async (data = "") => void child.stdin.end(data),
      kill,
      exited,
    };
  },
};

// ---- in-memory Buzz relay session -------------------------------------------
const events = [];
let eventId = 0;
const matches = (filter, event) =>
  (!filter.kinds || filter.kinds.includes(event.kind)) &&
  (!filter.authors || filter.authors.includes(event.pubkey)) &&
  Object.entries(filter)
    .filter(([key]) => key.startsWith("#"))
    .every(([key, values]) => event.tags.some((tag) => tag[0] === key.slice(1) && values.includes(tag[1])));
const publish = (pubkey, input) => {
  const event = { id: (++eventId).toString(16).padStart(64, "0"), pubkey, created_at: Math.floor(Date.now() / 1000) + eventId, sig: "", ...input };
  events.push(event);
  return event.id;
};
const profiles = new Map([
  [VIEWER, { name: "Harness" }],
  [PEER_BUZZ, { name: "Peer" }],
  [UNBOUND_BUZZ, { name: "Nobody" }],
  [CAROL_BUZZ, { name: "Carol" }],
]);
const nip19 = require("nostr-tools/nip19");
const { generateSecretKey, getPublicKey } = require("nostr-tools/pure");
/** main's typedPublicKey: an exact 64-hex key or npub (with or without `nostr:`). */
function typedPublicKey(text) {
  const value = text.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  try {
    const decoded = nip19.decode(value.replace(/^nostr:/i, ""));
    return decoded.type === "npub" ? decoded.data : undefined;
  } catch {
    return undefined;
  }
}
const relaySession = {
  scope: "harness",
  viewer: VIEWER,
  async readRemote(filters) {
    if (!filters.every((f) => f.kinds?.length)) throw new Error("p-gate: kinds required");
    return events.filter((event) => filters.some((filter) => matches(filter, event)));
  },
  outbox: {
    supports: (kind) => kind === 30315,
    send: (input) => publish(VIEWER, input),
  },
  profiles: { subscribe: () => () => {}, snapshot: () => profiles, ensure: async () => {} },
  media: () => undefined,
  // Stock: the DM people directory the New message picker reads, with main's
  // argument checks (direct-messages.ts): pages start at 1, queries <= 100.
  directMessages: {
    available: true,
    async people(query, page) {
      if (query.length > 100 || !Number.isSafeInteger(page) || page < 1) throw new Error("Invalid people search.");
      const value = query.trim();
      const exact = typedPublicKey(value);
      const wanted = value.toLowerCase();
      return {
        people: [...profiles]
          .map(([pubkey, profile]) => ({ ...profile, pubkey }))
          .filter((p) => p.pubkey !== VIEWER && (exact ? p.pubkey === exact : p.name.toLowerCase().includes(wanted))),
        hasMore: false,
      };
    },
  },
};

// ---- Buzz component stand-ins (stock services only) ---------------------------
const last = {};
const ui = {
  Markdown(props) {
    last.markdown = props;
    return h("div", { "data-testid": "markdown" }, props.content);
  },
  Composer(props) {
    last.composer = props;
    return h("textarea", { "aria-label": props.label, disabled: !!props.submission?.disabled, readOnly: true });
  },
  Message(props) {
    return h("div", { "data-testid": "message", "data-author": props.row.authorId, "data-day": String(props.day) }, props.row.content);
  },
};
// panels.ui.Workspace: the tab frame; records its header identity.
function Workspace(props) {
  last.workspace = props;
  return h(
    "div",
    { "data-testid": "workspace" },
    h("header", null, props.identity, h("div", { className: "panel-header-actions" }, props.actions)),
    props.items.find((item) => item.id === props.value)?.content,
  );
}

// The selected community: stock `relay` notifies its subscribers on a switch.
let community = COMMUNITY_A;
const relayListeners = new Set();
const switchCommunity = (origin) => {
  community = origin;
  for (const listener of [...relayListeners]) listener();
};

const pages = [];
const sections = [];
const cards = [];
const cleanups = [];
const ctx = {
  react: React,
  host,
  pages: { register: (page) => pages.push(page) },
  relay: {
    snapshot: () => ({ status: "ready", viewer: VIEWER, origin: community, session: relaySession }),
    subscribe: (listener) => (relayListeners.add(listener), () => relayListeners.delete(listener)),
    selected: () => community,
  },
  navigation: { open: async (target) => ((navTarget = target), render(), { status: "opened" }) },
  conversation: { ui },
  panels: { ui: { Workspace } },
  settingsCards: { register: (card) => cards.push(card) },
  effect: (fn) => cleanups.push(fn() ?? (() => {})),
  reflect: { get: (name) => (name === "sidebarSections" ? { register: registerSection } : undefined) },
};

// main's SidebarSectionsService.register checks (sidebar-sections-service.ts).
function registerSection(section) {
  const id = /^[a-z0-9][a-z0-9._-]*$/;
  const ok =
    section?.version === 1 &&
    id.test(section.id) &&
    typeof section.title === "string" &&
    section.title.trim() &&
    section.icon != null &&
    typeof section.rows?.snapshot === "function" &&
    typeof section.rows?.subscribe === "function" &&
    typeof section.select === "function" &&
    (section.actions === undefined ||
      (Array.isArray(section.actions) &&
        section.actions.every(
          (action) =>
            id.test(action?.id) &&
            typeof action.label === "string" &&
            action.label.trim() &&
            action.icon != null &&
            typeof action.onSelect === "function",
        )));
  if (!ok) throw new Error("A sidebar section needs an id, title, rows, and select action");
  sections.push(section);
}

let source = readFileSync(fileURLToPath(new URL("../plugin/plugin.js", import.meta.url)), "utf8");
// The harness keeps to the local relay and file-stored keys: no test accounts
// on the public relay or in the login keychain.
for (const [from, to] of [
  ['const HOME_ROOT = "~/.buzz-marmot";', `const HOME_ROOT = ${JSON.stringify(HARNESS_ROOT)};`],
  [/const MARMOT_RELAYS = Object\.freeze\(\[[^\]]*\]\);/, `const MARMOT_RELAYS = Object.freeze(["${LOCAL_RELAY}"]);`],
  ['WN_SECRET_STORE: "keychain",', 'WN_SECRET_STORE: "file", WN_ALLOW_LOOPBACK_RELAYS: "1",'],
]) {
  const patched = source.replace(from, to);
  if (patched === source) throw new Error(`plugin.js no longer contains ${from}`);
  source = patched;
}
const plugin = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
plugin.apply(ctx);
log("registered pages:", pages.map((p) => [p.id, p.layout, p.conversationNavigation]), "sections:", sections.map((s) => [s.id, s.actions.map((a) => a.label)]), "cards:", cards.map((c) => c.id));
const newAction = sections[0].actions.find((action) => action.id === "new-chat");
if (pages[0].layout !== "workspace" || !pages[0].conversationNavigation || !newAction)
  throw new Error("expected a full-width page that keeps the Messages sidebar, and a New encrypted chat section action");

const root = createRoot(document.getElementById("root"));
createRoot(document.getElementById("settings")).render(h(cards[0].component, { active: () => true }));
let navTarget = null;
let entry = 0;
function render() {
  entry++;
  root.render(h(pages[0].component, { navigation: navTarget ? { target: navTarget, entryId: String(entry) } : undefined }));
}
render();

const text = () => document.getElementById("root").textContent;
async function waitFor(what, predicate, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}; page text: ${text().slice(0, 600)}`);
}
const byText = (tag, label) => [...document.querySelectorAll(tag)].find((el) => el.textContent.trim() === label);
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const submit = (value) => last.composer.submission.submit({ text: value, recipients: [] });
const setInput = (input, value) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
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
/** `wn --json` in a CLI account's home, on the local relay with file-stored keys. */
const wnIn = (dir, who) => (...args) => {
  const env = { ...process.env, WN_SECRET_STORE: "file", WN_ALLOW_LOOPBACK_RELAYS: "1" };
  for (const key of ["WN_SOCKET", "WN_HOME", "WN_ACCOUNT"]) delete env[key];
  let out;
  try {
    out = execFileSync("wn", ["--home", ".", "--json", ...args], { cwd: dir, env, encoding: "utf8" });
  } catch (error) {
    out = error.stdout ?? "";
  }
  const value = JSON.parse(out.trim().split("\n").at(-1));
  if (!value.ok) throw new Error(`${who} ${args.join(" ")}: ${JSON.stringify(value.error)}`);
  return value.result;
};
const peer = wnIn(PEER_HOME, "peer");
const carol = wnIn(CAROL_HOME, "carol");
const rows = () => sections[0].rows.snapshot();

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
  const repoUrl = /const PLUGIN_REPO_URL = "([^"]+)"/.exec(source)?.[1];
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

const menu = (label) => document.querySelector(`[role=menu][aria-label="${label}"]:not([data-ending-style])`);
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
async function setUntagged(on) {
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
async function checkSectionMenu(npub) {
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

const rowIds = () => rows().map((row) => row.id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unreadRow = (id) => rows().find((row) => row.id === id)?.icon?.props?.unread === true;
const shownRow = (row) => [row.label, row.status ?? (row.icon?.props?.unread ? "unread" : "")];

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
function drawnRow(id) {
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

/** Unread is incoming-only, shown like a DM row, filtered by Unreads, and cleared by viewing. */
async function checkUnread(groupId) {
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
    const menu = (name) => document.querySelector(`[role=menu][aria-label="${name}"]:not([data-ending-style])`);
    click(menu("More actions for Encrypted messages").querySelectorAll("[role^=menuitem]")[0]);
    click([...menu("Filter Encrypted messages").querySelectorAll("[role^=menuitem]")].find((el) => el.textContent === label));
    await waitFor("the menu to close", () => !menu("More actions for Encrypted messages"), 5_000);
  };
  await filterTo("Unreads");
  if (!rows().some((row) => row.id === groupId)) throw new Error("Unreads hides an unread chat");
  await filterTo("All");
  header.remove();

  navTarget = sections[0].select(rows().find((row) => row.id === groupId));
  render();
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

/** The To field's lookups (names, Buzz keys, Marmot IDs, junk) and a third
 * person's chats: an untagged chat with them is never reused, a raw Marmot ID
 * invite is tagged for the community, and a New chat to them continues it. */
async function checkCarol(bound) {
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

  await newAction.onSelect();
  await waitFor("the New chat view", () => last.composer?.channelId === "marmot:new");
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
  navTarget = sections[0].select(rows().find((row) => row.id === untagged));
  render();
  await waitFor("the untagged invite", () => byText("button", "Accept"));
  click(byText("button", "Accept"));
  await waitFor("the untagged chat accepted", () => !byText("button", "Accept") && last.composer?.channelId === `marmot:${untagged}`, 60_000);
  await setUntagged(false);
  log("accepted Carol's untagged chat", untagged.slice(0, 16));

  await newAction.onSelect();
  await waitFor("the New chat view", () => last.composer?.channelId === "marmot:new");
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
  await newAction.onSelect();
  await waitFor("the New chat view", () => last.composer?.channelId === "marmot:new");
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

function ensurePeer() {
  mkdirSync(PEER_HOME, { recursive: true, mode: 0o700 });
  if (!peer("daemon", "status").running) {
    peer("daemon", "start", "--discovery-relays", LOCAL_RELAY, "--default-account-relays", LOCAL_RELAY);
    execFileSync("sleep", ["3"]);
  }
  const existing = peer("accounts", "list").accounts.find((a) => a.local_signing);
  if (existing) return { id: existing.account_id, npub: existing.npub };
  const created = peer("create-identity");
  if (!created.relay_lists?.complete) throw new Error("peer identity has incomplete relay lists");
  return { id: created.account_id, npub: created.npub };
}

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
    navTarget = sections[0].select(rows().find((r) => r.id === peerGroup));
    render();
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

    log("New encrypted chat from the Encrypted section's action");
    await newAction.onSelect();
    await waitFor("the New chat view", () => last.composer?.channelId === "marmot:new");
    await checkUnread(peerGroup);
    await newAction.onSelect();
    await waitFor("the New chat view", () => last.composer?.channelId === "marmot:new");
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

    const untagged = peer("groups", "create", `untagged ${Date.now() % 100000}`, bound.npub).group_id;
    await setUntagged(true);
    await waitFor("the untagged invite with Show untagged chats on", () => rowIds().includes(untagged), 240_000);
    await setUntagged(false);
    if (rowIds().includes(untagged)) throw new Error("an untagged invite is listed with Show untagged chats off");
    if (!rowIds().includes(newGroup)) throw new Error("A's own chat went missing in A");
    log("community: an untagged invite is hidden by default and shown with Show untagged chats");
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
