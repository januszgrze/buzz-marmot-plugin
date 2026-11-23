// The Buzz host stand-in: a plugin ctx with stock services only, component
// stand-ins that record their props, and the real plugin/plugin.js applied
// to it (patched onto the local relay and file-stored keys).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COMMUNITY_A, HARNESS_ROOT, LOCAL_RELAY, VIEWER, log } from "./config.mjs";
import { React, createRoot, h } from "./dom.mjs";
import { relaySession } from "./relay.mjs";
import { host } from "./wn.mjs";

/** The latest props of each Buzz component stand-in. */
export const last = {};
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
export let community = COMMUNITY_A;
const relayListeners = new Set();
export const switchCommunity = (origin) => {
  community = origin;
  for (const listener of [...relayListeners]) listener();
};

export const pages = [];
export const sections = [];
export const cards = [];
/** Run when the harness finishes (plugin effects, Carol's daemon). */
export const cleanups = [];
const ctx = {
  react: React,
  host,
  pages: { register: (page) => pages.push(page) },
  relay: {
    snapshot: () => ({ status: "ready", viewer: VIEWER, origin: community, session: relaySession }),
    subscribe: (listener) => (relayListeners.add(listener), () => relayListeners.delete(listener)),
    selected: () => community,
  },
  navigation: { open: async (target) => (navigate(target), { status: "opened" }) },
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

/** The plugin bundle as loaded, after the harness's patches. */
export let source = readFileSync(fileURLToPath(new URL("../../plugin/plugin.js", import.meta.url)), "utf8");
// The harness keeps to the local relay and file-stored keys: no test accounts
// on the public relay or in the login keychain.
for (const [from, to] of [
  [/\b(const|var) HOME_ROOT = "~\/\.buzz-marmot";/, (_, decl) => `${decl} HOME_ROOT = ${JSON.stringify(HARNESS_ROOT)};`],
  [/\b(const|var) MARMOT_RELAYS = Object\.freeze\(\[[^\]]*\]\);/, (_, decl) => `${decl} MARMOT_RELAYS = Object.freeze(["${LOCAL_RELAY}"]);`],
  ['WN_SECRET_STORE: "keychain",', 'WN_SECRET_STORE: "file", WN_ALLOW_LOOPBACK_RELAYS: "1",'],
]) {
  const patched = source.replace(from, to);
  if (patched === source) throw new Error(`plugin.js no longer contains ${from}`);
  source = patched;
}
const plugin = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
plugin.apply(ctx);
log("registered pages:", pages.map((p) => [p.id, p.layout, p.conversationNavigation]), "sections:", sections.map((s) => [s.id, s.actions.map((a) => a.label)]), "cards:", cards.map((c) => c.id));
/** The Encrypted section's "+" (New encrypted chat) action. */
export const newAction = sections[0].actions.find((action) => action.id === "new-chat");
if (pages[0].layout !== "workspace" || !pages[0].conversationNavigation || !newAction)
  throw new Error("expected a full-width page that keeps the Messages sidebar, and a New encrypted chat section action");

export const root = createRoot(document.getElementById("root"));
createRoot(document.getElementById("settings")).render(h(cards[0].component, { active: () => true }));
/** Where the plugin page was last navigated to. */
export let navTarget = null;
let entry = 0;
function render() {
  entry++;
  root.render(h(pages[0].component, { navigation: navTarget ? { target: navTarget, entryId: String(entry) } : undefined }));
}
/** Opens the plugin page at `target`, as Buzz's navigation does. */
export function navigate(target) {
  navTarget = target;
  render();
}
render();

/** The Encrypted section's rows, as the sidebar would list them. */
export const rows = () => sections[0].rows.snapshot();
export const rowIds = () => rows().map((row) => row.id);
/** Opens the chat behind the sidebar row `id`. */
export const openRow = (id) => navigate(sections[0].select(rows().find((row) => row.id === id)));
