// Marmot chats: end-to-end encrypted MLS group chats for Buzz, run through
// MDK's `wn` CLI. `wn daemon start` launches `wnd` in its own process group,
// so the daemon outlives the plugin; every other call is a short `wn --json`
// process. Each Buzz identity gets its own wn home, daemon, socket and account.
//
// It needs only stock Buzz 1.0 plugin services. Conversations use Buzz's own
// message rows, composer and tab workspace; the New chat view, header
// identity and Marmot ID card copy Buzz's DM markup with its global classes
// and tokens where stock offers no component. Each identity publishes its
// Marmot key as an addressable kind 30315 event (d = `marmot.chats:binding`),
// signed by its Buzz key, so others can invite it by picking the Buzz person.
export const inject = [
  "react",
  "pages",
  "host",
  "relay",
  "navigation",
  "conversation",
  "settingsCards",
  "panels",
];

const PLUGIN_ID = "marmot.chats";
const PAGE_ID = "chats";
// Marmot relays: the daemon's discovery relays and new accounts' default
// relays (which new groups use). Homes are kept per relay set, so changing
// this starts fresh accounts and leaves the old homes untouched.
const MARMOT_RELAYS = Object.freeze(["wss://relay.us.whitenoise.chat"]);
// Where people can contribute; linked from the conversation's info popover.
const PLUGIN_REPO_URL = "https://github.com/januszgrze/buzz-marmot-plugin";
const HOME_ROOT = "~/.buzz-marmot";
const RELAY_SET = MARMOT_RELAYS.map((url) =>
  url.replace(/^wss?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "_"),
).join("+");
// Account keys live in the macOS login keychain, one service per home
// (`buzz-marmot.<home id>`), so two Buzz identities never share an entry.
const KEYCHAIN_SERVICE_PREFIX = "buzz-marmot.";
const ENV = Object.freeze({
  WN_SECRET_STORE: "keychain",
  WN_HOME: null,
  WN_SOCKET: null,
  WN_ACCOUNT: null,
});
const MAX_PARALLEL = 4;
const COMMAND_TIMEOUT_MS = 120_000;
// A freshly started daemon has no relay connection yet; an identity created
// before it connects lacks its relay lists (and so cannot be invited).
const RELAY_SETTLE_MS = 3_000;
const CREATE_ATTEMPTS = 3;
const POLL_MS = 20_000;
const STREAM_RESTART_MS = 5_000;
const HISTORY_LIMIT = "200";
const CHAT_KIND = 9;
// NIP-38 user status is the one addressable kind Buzz signs for any `d` today;
// Buzz reads only `d=general` statuses. Kind 30078 is the intended home once
// Buzz's signer accepts plugin app data.
const BINDING_KIND = 30315;
const BINDING_D = "marmot.chats:binding";
const DIRECTORY_LIMIT = 500;
// A chat's Buzz community rides in its MLS group description (encrypted group
// data, so invitees see it and Marmot relays do not), as one line:
// `buzz-community/v1 wss://host[:port]`. Other versions read as untagged.
const COMMUNITY_TAG = "buzz-community/v1";
const COMMUNITY_LINE = /^buzz-community\/v1 (wss?:\/\/\S+)$/m;
const STACK_SECONDS = 5 * 60;
const HEX = /^[0-9a-f]+$/;
const HEX_KEY = /^[0-9a-f]{64}$/;
// Buzz's people search (`directMessages.people`) rejects longer queries and
// pages below 1 with "Invalid people search."
const PEOPLE_SEARCH_MAX_LENGTH = 100;
const NPUB = /^npub1[02-9ac-hj-np-z]{58}$/;
const NEW_CHAT = Object.freeze({ new: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failure = (code, message) => ({ ok: false, error: { code, message } });

function parseEnvelope(stdout, stderr, exitCode) {
  const lines = stdout.split("\n").map((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!lines[index].startsWith("{")) continue;
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value.ok === "boolean") return value;
    } catch {}
  }
  const detail = (stderr || stdout).trim().slice(-600);
  return failure(
    "bad_output",
    detail || `wn exited with ${exitCode ?? "a signal"} and printed nothing`,
  );
}

function errorText(error) {
  if (!error) return "Unknown error";
  return error.code ? `${error.message} (${error.code})` : error.message;
}

function shortKey(key) {
  return key ? `${key.slice(0, 10)}…${key.slice(-6)}` : "";
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** The hex key of a checksummed `npub1…` (NIP-19), or null. */
function npubToHex(text) {
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return null;
  const value = text.toLowerCase();
  if (value.length !== 63 || !value.startsWith("npub1")) return null;
  const data = [...value.slice(5)].map((c) => BECH32.indexOf(c));
  if (data.some((v) => v < 0)) return null;
  let check = 1;
  for (const v of [3, 3, 3, 3, 0, 14, 16, 21, 2, ...data]) {
    const top = check >>> 25;
    check = ((check & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) check ^= BECH32_GEN[i];
  }
  if (check !== 1) return null;
  let acc = 0;
  let bits = 0;
  let hex = "";
  for (const v of data.slice(0, -6)) {
    acc = ((acc << 5) | v) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      hex += ((acc >> bits) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return hex.length === 64 && bits < 5 && !(acc & ((1 << bits) - 1)) ? hex : null;
}

/** The hex key that pasted text names: 64 hex characters, or an npub with or
 * without `nostr:`. Spaces and invisible characters a copy can carry are
 * dropped. Null for anything else, including a key still being typed. */
function typedKey(text) {
  const value = String(text ?? "")
    .replace(/[\s\u200b-\u200d\u2060\ufeff]+/g, "")
    .replace(/^nostr:/i, "");
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  return /^npub1/i.test(value) ? npubToHex(value) : null;
}

/** A community origin or relay URL as `wss://host[:port]` (`ws://` for a
 * plaintext relay), lowercase, default port and trailing slash dropped. */
function normalizeCommunity(value) {
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

function chatCommunity(description) {
  const line = COMMUNITY_LINE.exec(description ?? "");
  return line ? normalizeCommunity(line[1]) : null;
}

function chatRow(chat) {
  return {
    id: chat.group_id,
    name: chat.profile?.name?.trim() || "Untitled chat",
    description: chat.profile?.description?.trim() || "",
    community: chatCommunity(chat.profile?.description),
    unread: chat.unread_count || 0,
    last: chat.last_message?.plaintext ?? "",
    at: chat.activity_sort_at || 0,
    pending: !!chat.pending_confirmation,
  };
}

function messageRow(message) {
  return {
    id: message.message_id,
    from: message.from,
    own: message.direction === "sent",
    text: message.plaintext ?? "",
    at: message.received_at || message.recorded_at || 0,
  };
}

/** Runs `wn --home . --json …` in `cwd` (the identity's home) and parses its
 * envelope. Errors are JSON on stdout too, with a nonzero exit. */
function createRunner(host, cwd) {
  let active = 0;
  const waiting = [];
  async function slot(task) {
    while (active >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  }
  function spawn(args, onStdout, onStderr) {
    if (typeof host.spawn !== "function")
      throw new Error("This Buzz build cannot start processes.");
    return host.spawn("wn", {
      args: ["--home", ".", "--json", ...args],
      cwd,
      env: envFor(cwd),
      onStdout,
      onStderr,
    });
  }
  function run(args) {
    return slot(async () => {
      let stdout = "";
      let stderr = "";
      let child;
      try {
        child = await spawn(
          args,
          (data) => {
            stdout += data;
          },
          (data) => {
            stderr += data;
          },
        );
      } catch (error) {
        return failure(
          "spawn_failed",
          `Could not start wn: ${error?.message ?? error}`,
        );
      }
      child.end().catch(() => {});
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), COMMAND_TIMEOUT_MS);
      });
      const code = await Promise.race([child.exited, timeout]);
      clearTimeout(timer);
      if (code === "timeout") {
        child.kill();
        return failure("timeout", `wn ${args.join(" ")} took too long`);
      }
      return parseEnvelope(stdout, stderr, code);
    });
  }
  /** A long-lived NDJSON subscription; stdout arrives in arbitrary chunks. */
  async function stream(args, onRecord, onExit) {
    let buffer = "";
    const child = await spawn(args, (data) => {
      buffer += data;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        onRecord(record);
      }
    });
    child.exited.then((code) => onExit?.(code));
    return child;
  }
  return { run, stream };
}

function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = {
        ...state,
        ...(typeof patch === "function" ? patch(state) : patch),
      };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---- the sidebar section's "…" menu -------------------------------------------
// Stock Buzz gives a plugin section icon actions only (no menu), and the plugin
// has no ReactDOM to portal one. So the menu is plain DOM in Buzz's own menu
// markup and global classes, the way its Menu component renders them.

const SVG_NS = "http://www.w3.org/2000/svg";
// Tabler paths of the icons Buzz's DM menu uses; `fill` marks a solid shape.
const MENU_GLYPHS = {
  filter: ["M4 6h16", "M6 12h12", "M9 18h6"],
  sort: ["M17 3l0 18", "M10 18l-3 3l-3 -3", "M7 21l0 -18", "M20 6l-3 -3l-3 3"],
  all: [
    "M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10",
    "M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2",
  ],
  unreads: [
    "M13 4.2c-2.3-.3-4.7.3-6.6 1.6C2.9 8.3 2 12.7 4.3 16.1L3 20l4.7-1c4 1.9 8.9.9 11.6-2.3 1.4-1.7 2-3.7 1.7-5.7",
    { d: "M16 5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", fill: true },
  ],
  recent: ["M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0", "M14.5 10.5l-2.5 2.5", "M17 8l1 -1", "M14 3h-4"],
  alpha: ["M14 15.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0", "M3 19v-10.5a3.5 3.5 0 0 1 7 0v10.5", "M3 13h7", "M21 12v7"],
  copy: [
    "M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
    "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1",
  ],
  tag: [
    "M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3z",
  ],
  next: ["M9 6l6 6l-6 6"],
  check: ["M5 12l5 5l10 -10"],
};

function glyph(doc, name, size) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, String(value));
  for (const part of MENU_GLYPHS[name] ?? []) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", typeof part === "string" ? part : part.d);
    if (part.fill) {
      path.setAttribute("fill", "currentColor");
      path.setAttribute("stroke", "none");
    }
    svg.append(path);
  }
  return svg;
}

/**
 * Opens a menu under `anchor` and returns its close function. Entries:
 * `{ kind: "choices", label, icon, value, choices: [{ value, label, icon }], change }`
 * (a submenu of radio items), `{ kind: "check", label, icon, checked, change }`,
 * `{ kind: "item", label, icon, disabled?, run }` and `{ kind: "separator" }`.
 */
function openMenu(anchor, title, entries, onClosed) {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView;
  const label = `More actions for ${title}`;
  const frame = (callback) =>
    win.requestAnimationFrame ? win.requestAnimationFrame(callback) : win.setTimeout(callback, 16);
  const EDGE = 8;
  const layers = [];
  let sub = null;
  let closed = false;

  const enabled = (layer) => layer.items.filter((item) => !item.hasAttribute("data-disabled"));
  const highlight = (layer, item, focus) => {
    for (const other of layer.items) other.toggleAttribute("data-highlighted", other === item);
    if (item && focus) item.focus({ preventScroll: true });
  };
  const dismiss = (layer) => {
    layer.popup.setAttribute("data-ending-style", "");
    win.setTimeout(() => layer.positioner.remove(), 150);
  };

  const layer = (side, rect, ariaLabel, build) => {
    const positioner = doc.createElement("div");
    positioner.className = "buzz-menu-positioner";
    Object.assign(positioner.style, { position: "fixed", left: "0", top: "0", visibility: "hidden" });
    const popup = doc.createElement("div");
    popup.className = "buzz-menu-popup text-body-sm";
    popup.setAttribute("data-buzz-ui", "");
    popup.setAttribute("data-size", "default");
    popup.setAttribute("data-side", side);
    popup.setAttribute("role", "menu");
    popup.setAttribute("aria-label", ariaLabel);
    popup.tabIndex = -1;
    popup.style.setProperty("--available-height", `${win.innerHeight - 2 * EDGE}px`);
    popup.style.setProperty("--available-width", `${win.innerWidth - 2 * EDGE}px`);
    popup.style.setProperty("--transform-origin", side === "bottom" ? "top right" : "top left");
    positioner.append(popup);
    doc.body.append(positioner);
    const entry = { positioner, popup, items: [] };
    build(entry);
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    let left = side === "bottom" ? rect.right - width : rect.right + 4;
    let top = side === "bottom" ? rect.bottom + 4 : rect.top - 4;
    if (side === "right" && left + width > win.innerWidth - EDGE) left = rect.left - 4 - width;
    if (side === "bottom" && top + height > win.innerHeight - EDGE) top = rect.top - 4 - height;
    left = Math.max(EDGE, Math.min(left, win.innerWidth - EDGE - width));
    top = Math.max(EDGE, Math.min(top, win.innerHeight - EDGE - height));
    Object.assign(positioner.style, { left: `${left}px`, top: `${top}px`, visibility: "" });
    popup.setAttribute("data-starting-style", "");
    frame(() => frame(() => popup.removeAttribute("data-starting-style")));
    popup.addEventListener("keydown", (event) => keys(entry, event));
    layers.push(entry);
    return entry;
  };

  const item = (into, { role = "menuitem", icon, text, disabled, checked, trailing }) => {
    const el = doc.createElement("div");
    el.className = "buzz-menu-item";
    el.setAttribute("role", role);
    el.tabIndex = -1;
    if (disabled) {
      el.setAttribute("data-disabled", "");
      el.setAttribute("aria-disabled", "true");
    }
    const iconEl = doc.createElement("span");
    iconEl.className = "buzz-menu-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.append(glyph(doc, icon, 14));
    if (role === "menuitemradio" || role === "menuitemcheckbox") {
      if (role === "menuitemradio") el.setAttribute("data-selection", "check");
      el.setAttribute("aria-checked", String(!!checked));
      el.toggleAttribute("data-checked", !!checked);
      const choice = doc.createElement("span");
      choice.className = "buzz-menu-choice-label";
      choice.append(iconEl, text);
      const indicator = doc.createElement("span");
      indicator.className = "buzz-menu-item-indicator";
      indicator.toggleAttribute("data-checked", !!checked);
      indicator.append(glyph(doc, "check", 16));
      el.append(choice, indicator);
    } else {
      el.append(iconEl, text);
      if (trailing) el.append(trailing);
    }
    el.addEventListener("pointermove", () => {
      if (!el.hasAttribute("data-highlighted") && !disabled) highlight(into, el, true);
    });
    into.items.push(el);
    into.popup.append(el);
    return el;
  };

  const closeSub = (focusTrigger) => {
    if (!sub) return;
    dismiss(sub.layer);
    layers.splice(layers.indexOf(sub.layer), 1);
    sub.trigger.removeAttribute("data-popup-open");
    sub.trigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) highlight(root, sub.trigger, true);
    sub = null;
  };
  const openSub = (trigger, entry, focusFirst) => {
    if (sub?.trigger !== trigger) {
      closeSub(false);
      trigger.setAttribute("data-popup-open", "");
      trigger.setAttribute("aria-expanded", "true");
      const submenu = layer("right", trigger.getBoundingClientRect(), `${entry.label} ${title}`, (into) => {
        for (const choice of entry.choices) {
          const el = item(into, { role: "menuitemradio", icon: choice.icon, text: choice.label, checked: choice.value === entry.value });
          el.addEventListener("click", () => {
            entry.change(choice.value);
            close(true);
          });
        }
      });
      sub = { layer: submenu, trigger };
    }
    if (focusFirst) highlight(sub.layer, enabled(sub.layer)[0], true);
  };

  const close = (restoreFocus) => {
    if (closed) return;
    closed = true;
    closeSub(false);
    for (const each of layers) dismiss(each);
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("scroll", scrolled, true);
    win.removeEventListener("blur", blurred);
    win.removeEventListener("resize", blurred);
    anchor.setAttribute("aria-expanded", "false");
    anchor.removeAttribute("data-popup-open");
    if (restoreFocus) anchor.focus({ preventScroll: true });
    onClosed();
  };

  function keys(at, event) {
    const items = enabled(at);
    const current = items.indexOf(doc.activeElement);
    const go = (index) => highlight(at, items[(index + items.length) % items.length], true);
    const isSub = at !== root;
    switch (event.key) {
      case "ArrowDown":
        go(current < 0 ? 0 : current + 1);
        break;
      case "ArrowUp":
        go(current < 0 ? -1 : current - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(-1);
        break;
      case "Enter":
      case " ":
        if (current >= 0) items[current].click();
        break;
      case "ArrowRight":
        if (!isSub && current >= 0 && items[current].getAttribute("aria-haspopup") === "menu") items[current].click();
        break;
      case "ArrowLeft":
        if (isSub) closeSub(true);
        break;
      case "Escape":
        if (isSub) closeSub(true);
        else close(true);
        break;
      case "Tab":
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
  function outside(event) {
    if (anchor.contains(event.target) || layers.some((each) => each.positioner.contains(event.target))) return;
    close(false);
  }
  function scrolled(event) {
    if (!layers.some((each) => each.positioner.contains(event.target))) close(false);
  }
  function blurred() {
    close(false);
  }

  const root = layer("bottom", anchor.getBoundingClientRect(), label, (into) => {
    for (const entry of entries) {
      if (entry.kind === "separator") {
        const line = doc.createElement("div");
        line.className = "buzz-menu-separator";
        line.setAttribute("role", "separator");
        into.popup.append(line);
        continue;
      }
      if (entry.kind === "choices") {
        const arrow = doc.createElement("span");
        arrow.className = "buzz-menu-submenu-arrow";
        arrow.append(glyph(doc, "next", 14));
        const el = item(into, { icon: entry.icon, text: entry.label, trailing: arrow });
        el.setAttribute("aria-haspopup", "menu");
        el.setAttribute("aria-expanded", "false");
        el.addEventListener("pointerenter", () => openSub(el, entry, false));
        el.addEventListener("click", () => openSub(el, entry, true));
        continue;
      }
      if (entry.kind === "check") {
        const el = item(into, { role: "menuitemcheckbox", icon: entry.icon, text: entry.label, checked: entry.checked });
        el.addEventListener("pointerenter", () => closeSub(false));
        el.addEventListener("click", () => {
          close(true);
          entry.change(!entry.checked);
        });
        continue;
      }
      const el = item(into, { icon: entry.icon, text: entry.label, disabled: entry.disabled });
      el.addEventListener("pointerenter", () => closeSub(false));
      el.addEventListener("click", () => {
        if (entry.disabled) return;
        close(true);
        entry.run();
      });
    }
  });
  anchor.setAttribute("aria-haspopup", "menu");
  anchor.setAttribute("aria-expanded", "true");
  anchor.setAttribute("data-popup-open", "");
  root.popup.focus({ preventScroll: true });
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("scroll", scrolled, true);
  win.addEventListener("blur", blurred);
  win.addEventListener("resize", blurred);
  return close;
}

const INITIAL = Object.freeze({
  phase: "waiting", // waiting | starting | ready | failed
  step: "Waiting for your Buzz identity…",
  error: null,
  home: null,
  account: null,
  relayListsComplete: true,
  chats: [],
  invites: [],
  selected: null,
  messages: {},
  members: {},
  notice: null,
  binding: "pending", // pending | published | unsupported | failed
  bindingError: null,
  // Marmot account hex -> Buzz pubkey, from published bindings.
  directory: {},
});

/** Owns one identity's daemon, account, feeds and polling. */
function createSession(host, home, store, hooks) {
  const wn = createRunner(host, home);
  const set = store.set;
  let stopped = false;
  let chatFeed = null;
  let messageFeed = null;
  let messageFeedGroup = null;
  let poll = null;
  let refreshTimer = null;
  const membersLoading = new Set();
  const account = () => store.get().account;
  const as = (...args) => ["--account", account().id, ...args];

  function fail(error, step) {
    if (stopped) return;
    set({ phase: "failed", error, step: step ?? store.get().step });
  }

  async function findAccount() {
    const listed = await wn.run(["accounts", "list"]);
    if (!listed.ok) return listed;
    const found = listed.result.accounts.find((a) => a.local_signing);
    return { ok: true, result: found ?? null };
  }

  async function createAccount() {
    let last = null;
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
      const created = await wn.run(["create-identity"]);
      if (created.ok && created.result.relay_lists?.complete) return created;
      last = created;
      // A half-made new account cannot be repaired by the CLI; remove it.
      const leftover = await findAccount();
      if (leftover.ok && leftover.result)
        await wn.run(["logout", leftover.result.account_id]);
      await sleep(RELAY_SETTLE_MS);
    }
    return last.ok
      ? failure(
          "relay_lists_incomplete",
          "Could not publish the new account's relay lists",
        )
      : last;
  }

  async function start() {
    set({
      ...INITIAL,
      phase: "starting",
      home,
      step: "Checking the Marmot daemon…",
    });
    const status = await wn.run(["daemon", "status"]);
    if (stopped) return;
    if (!status.ok) return fail(status.error);
    let justStarted = false;
    if (!status.result.running) {
      set({ step: "Starting the Marmot daemon…" });
      const started = await wn.run([
        "daemon",
        "start",
        "--discovery-relays",
        MARMOT_RELAYS.join(","),
        "--default-account-relays",
        MARMOT_RELAYS.join(","),
      ]);
      if (stopped) return;
      if (!started.ok) return fail(started.error);
      justStarted = true;
    }
    set({ step: "Loading your Marmot account…" });
    const found = await findAccount();
    if (stopped) return;
    if (!found.ok) return fail(found.error);
    let summary = found.result;
    if (!summary) {
      set({ step: "Creating your Marmot account…" });
      if (justStarted) await sleep(RELAY_SETTLE_MS);
      const created = await createAccount();
      if (stopped) return;
      if (!created.ok) return fail(created.error);
      summary = created.result;
    }
    const accountStatus = await wn.run([
      "accounts",
      "status",
      summary.account_id,
    ]);
    if (stopped) return;
    set({
      phase: "ready",
      step: "",
      account: { id: summary.account_id, npub: summary.npub },
      relayListsComplete: accountStatus.ok
        ? accountStatus.result.relay_lists?.complete !== false
        : true,
    });
    hooks.ready();
    await refresh();
    startChatFeed();
    // The daemon's own subscriptions can be slow to pick up a welcome for a
    // brand-new account; an explicit sync is cheap and catches it up.
    poll = setInterval(async () => {
      await wn.run(as("sync"));
      await refresh();
      hooks.poll();
    }, POLL_MS);
    const selected = store.get().selected;
    if (selected) void openChat(selected);
  }

  async function refresh() {
    if (stopped || !account()) return;
    const [chats, invites] = await Promise.all([
      wn.run(as("chats", "list")),
      wn.run(as("groups", "invites")),
    ]);
    if (stopped) return;
    const patch = {};
    if (chats.ok)
      patch.chats = chats.result.chats
        .map(chatRow)
        .sort((a, b) => b.at - a.at);
    if (invites.ok) patch.invites = invites.result.invites.map(chatRow);
    const error = (!chats.ok && chats.error) || (!invites.ok && invites.error);
    patch.notice = error ? errorText(error) : null;
    set(patch);
    // Names and avatars come from each chat's other members.
    const known = store.get().members;
    for (const chat of [...(patch.chats ?? []), ...(patch.invites ?? [])])
      if (!known[chat.id]) void loadMembers(chat.id);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 400);
  }

  async function startChatFeed() {
    if (stopped) return;
    try {
      chatFeed = await wn.stream(
        as("chats", "subscribe"),
        (record) => {
          if (record.result?.type === "chat") scheduleRefresh();
        },
        () => {
          chatFeed = null;
          if (!stopped) setTimeout(startChatFeed, STREAM_RESTART_MS);
        },
      );
      if (stopped) chatFeed.kill();
    } catch {
      if (!stopped) setTimeout(startChatFeed, STREAM_RESTART_MS);
    }
  }

  async function loadMessages(groupId) {
    const listed = await wn.run(
      as("messages", "list", groupId, "--limit", HISTORY_LIMIT),
    );
    if (stopped) return;
    if (!listed.ok) return set({ notice: errorText(listed.error) });
    const rows = listed.result.messages
      .filter((m) => m.kind === CHAT_KIND)
      .map(messageRow);
    set((s) => ({ messages: { ...s.messages, [groupId]: rows } }));
  }

  async function loadMembers(groupId) {
    if (membersLoading.has(groupId)) return;
    membersLoading.add(groupId);
    const listed = await wn
      .run(as("groups", "members", groupId))
      .finally(() => membersLoading.delete(groupId));
    if (stopped || !listed.ok) return;
    // Other members' Marmot account ids; this device's own account is local.
    const others = (listed.result.members ?? [])
      .filter((member) => !member.local && HEX_KEY.test(member.member_id ?? ""))
      .map((member) => member.member_id);
    set((s) => ({ members: { ...s.members, [groupId]: others } }));
  }

  function appendMessage(groupId, message) {
    set((s) => {
      const current = s.messages[groupId] ?? [];
      if (current.some((m) => m.id === message.message_id)) return {};
      return {
        messages: {
          ...s.messages,
          [groupId]: [...current, messageRow(message)],
        },
      };
    });
  }

  async function startMessageFeed(groupId) {
    messageFeed?.kill();
    messageFeed = null;
    messageFeedGroup = groupId;
    try {
      const child = await wn.stream(
        as("messages", "subscribe", groupId, "--limit", "0"),
        (record) => {
          const result = record.result;
          if (
            result?.type === "message" &&
            result.message?.kind === CHAT_KIND
          ) {
            appendMessage(groupId, result.message);
            hooks.author(result.message.from);
            if (viewing(groupId)) void markRead(groupId);
          } else if (result?.type === "message_delete") {
            void loadMessages(groupId);
          }
        },
        () => {
          if (messageFeed === child) messageFeed = null;
          if (
            !stopped &&
            messageFeedGroup === groupId &&
            store.get().selected === groupId
          )
            setTimeout(() => {
              if (!messageFeed && store.get().selected === groupId)
                void startMessageFeed(groupId);
            }, STREAM_RESTART_MS);
        },
      );
      if (stopped || messageFeedGroup !== groupId) child.kill();
      else messageFeed = child;
    } catch (error) {
      set({ notice: `Live updates are off: ${error?.message ?? error}` });
    }
  }

  async function openChat(groupId) {
    if (!HEX.test(groupId ?? "")) return;
    set({ selected: groupId });
    if (!account() || stopped) return;
    if (messageFeedGroup !== groupId || !messageFeed)
      void startMessageFeed(groupId);
    await Promise.all([loadMessages(groupId), loadMembers(groupId)]);
    if (viewing(groupId)) await markRead(groupId);
    scheduleRefresh();
  }

  /** On screen: the open chat while the window is visible. */
  function viewing(groupId) {
    return store.get().selected === groupId && globalThis.document?.visibilityState !== "hidden";
  }

  /** wn keeps the read marker per group, so unread survives reloads. */
  async function markRead(groupId) {
    if (!account() || stopped) return;
    set((s) => ({
      chats: s.chats.map((chat) => (chat.id === groupId && chat.unread ? { ...chat, unread: 0 } : chat)),
    }));
    await wn.run(as("chats", "mark-read", groupId));
  }

  function closeChat() {
    set({ selected: null });
  }

  async function send(groupId, text) {
    const sent = await wn.run(as("messages", "send", "--group", groupId, text));
    if (!sent.ok) return errorText(sent.error);
    // Own sends never arrive on the subscription; read them back.
    await loadMessages(groupId);
    scheduleRefresh();
    return null;
  }

  /** Whether `key` (hex) is a Marmot account with a fetchable KeyPackage on
   * its relays: `{ npub }` when it is, `{ missing }` when not, `{ error }`. */
  async function checkKey(key) {
    if (!account() || stopped) return { error: "Marmot is not ready yet." };
    const checked = await wn.run(as("keys", "check", key));
    if (checked.ok && checked.result?.available && checked.result.npub)
      return { npub: checked.result.npub };
    const code = checked.error?.code ?? "";
    if (checked.ok || /missing|not_found|relay_list/.test(code)) return { missing: true };
    return { error: errorText(checked.error) };
  }

  async function accept(groupId) {
    const accepted = await wn.run(as("groups", "accept", groupId));
    if (!accepted.ok) return errorText(accepted.error);
    await refresh();
    void openChat(groupId);
    return null;
  }

  async function decline(groupId) {
    const declined = await wn.run(as("groups", "decline", groupId));
    if (!declined.ok) return errorText(declined.error);
    if (store.get().selected === groupId) set({ selected: null });
    await refresh();
    return null;
  }

  /** Creates a group with `members` (npubs), tagged with `community`, and
   * reports who was not invited. */
  async function createChat(name, members, community) {
    const created = await wn.run(
      as(
        "groups",
        "create",
        `--description=${COMMUNITY_TAG} ${community}`,
        name,
        ...members,
      ),
    );
    if (!created.ok) return { error: errorText(created.error) };
    const groupId = created.result.group_id;
    const skipped = (created.result.member_outcomes ?? []).filter(
      (outcome) => outcome.status !== "selected",
    );
    const warning = skipped.length
      ? `Not invited: ${skipped.map((o) => `${shortKey(o.account_id_hex)} (${o.status})`).join(", ")}`
      : null;
    if (!groupId) return { error: warning ?? "No chat was created" };
    await refresh();
    return { groupId, warning };
  }

  function stop() {
    stopped = true;
    clearInterval(poll);
    clearTimeout(refreshTimer);
    chatFeed?.kill();
    messageFeed?.kill();
  }

  void start().catch((error) =>
    fail({ code: "unexpected", message: String(error?.message ?? error) }),
  );
  return {
    stop,
    refresh,
    openChat,
    closeChat,
    markRead,
    viewing,
    send,
    accept,
    decline,
    createChat,
    checkKey,
  };
}

function homeFor(viewer) {
  const id = (viewer ?? "")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 16);
  return id.length === 16 ? `${HOME_ROOT}/${RELAY_SET}/${id}` : null;
}

function envFor(home) {
  return { ...ENV, WN_KEYCHAIN_SERVICE: `${KEYCHAIN_SERVICE_PREFIX}${home.split("/").at(-1)}` };
}

/** A binding event's Marmot account, or null when it is not one. */
function parseBinding(event) {
  if (
    event?.kind !== BINDING_KIND ||
    !event.tags?.some((tag) => tag[0] === "d" && tag[1] === BINDING_D)
  )
    return null;
  try {
    const body = JSON.parse(event.content);
    if (HEX_KEY.test(body?.account) && NPUB.test(body?.npub))
      return { account: body.account, npub: body.npub };
  } catch {}
  return null;
}

/** The newest binding per Buzz author. */
function newestBindings(events) {
  const newest = new Map();
  for (const event of events ?? []) {
    const binding = parseBinding(event);
    if (!binding || !HEX_KEY.test(event.pubkey ?? "")) continue;
    const old = newest.get(event.pubkey);
    if (!old || event.created_at > old.at)
      newest.set(event.pubkey, { ...binding, at: event.created_at });
  }
  return newest;
}

const lockSvg =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  );

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const conversation = ctx.conversation;
  const ui = conversation?.ui ?? {};
  const kit = () => ctx.reflect.get("ui");
  const sidebarSections = ctx.reflect.get("sidebarSections");
  const store = createStore(INITIAL);
  let session = null;
  let sessionHome = null;
  let boundFor = null;

  const relaySession = () => {
    const snapshot = ctx.relay.snapshot();
    return snapshot.status === "ready" || snapshot.cached
      ? snapshot.session
      : undefined;
  };
  const viewer = () => ctx.relay.snapshot().viewer;
  // `selected()` names a community before it connects, so a switch shows at once.
  const activeCommunity = () =>
    normalizeCommunity(ctx.relay.selected?.() ?? ctx.relay.snapshot().origin);

  const PREFS_KEY = "marmot.chats:sidebar";
  const readPrefs = () => {
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? "{}");
      return {
        filter: saved.filter === "unreads" ? "unreads" : "all",
        sort: saved.sort === "alpha" ? "alpha" : "recent",
        untagged: saved.untagged === true,
      };
    } catch {
      return { filter: "all", sort: "recent", untagged: false };
    }
  };
  const prefs = createStore(readPrefs());
  const setPref = (patch) => {
    prefs.set(patch);
    try {
      globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs.get()));
    } catch {}
  };
  /** Chats tagged for the active community; with "Show untagged chats", all. */
  const inView = (chat, community, untagged) =>
    untagged || (!!community && chat.community === community);

  /** Publishes this identity's binding unless the relay already has it. */
  async function ensureBinding() {
    const relay = relaySession();
    const account = store.get().account;
    const buzz = viewer();
    if (!relay || !account || !buzz) return;
    const key = `${buzz}:${account.id}:${relay.scope ?? ""}`;
    if (boundFor === key) return;
    boundFor = key;
    if (
      typeof relay.readRemote !== "function" ||
      !relay.outbox?.supports?.(BINDING_KIND)
    ) {
      store.set({ binding: "unsupported", bindingError: null });
      return;
    }
    try {
      const current = newestBindings(
        await relay.readRemote([
          { kinds: [BINDING_KIND], authors: [buzz], "#d": [BINDING_D], limit: 5 },
        ]),
      ).get(buzz);
      if (current?.account !== account.id)
        relay.outbox.send({
          kind: BINDING_KIND,
          content: JSON.stringify({
            v: 1,
            account: account.id,
            npub: account.npub,
          }),
          tags: [
            ["d", BINDING_D],
            ["alt", "Marmot encrypted chats key for this Buzz identity"],
          ],
        });
      store.set({ binding: "published", bindingError: null });
    } catch (error) {
      boundFor = null;
      store.set({
        binding: "failed",
        bindingError: String(error?.message ?? error),
      });
    }
  }

  /** Every published binding in this community: Marmot key -> Buzz person.
   * A Marmot key claimed by two people names neither. */
  async function loadDirectory() {
    const relay = relaySession();
    if (typeof relay?.readRemote !== "function") return;
    try {
      const events = await relay.readRemote([
        { kinds: [BINDING_KIND], "#d": [BINDING_D], limit: DIRECTORY_LIMIT },
      ]);
      const directory = {};
      const claimed = new Set();
      for (const [buzz, found] of newestBindings(events)) {
        if (claimed.has(found.account)) delete directory[found.account];
        else directory[found.account] = buzz;
        claimed.add(found.account);
      }
      store.set({ directory });
    } catch {}
  }

  /** Marmot npubs for picked Buzz people; names everyone without one. */
  async function lookupBindings(pubkeys) {
    const relay = relaySession();
    if (typeof relay?.readRemote !== "function")
      return { error: "Buzz is not connected yet." };
    const found = newestBindings(
      (
        await relay.readRemote([
          {
            kinds: [BINDING_KIND],
            authors: pubkeys,
            "#d": [BINDING_D],
            limit: pubkeys.length * 4,
          },
        ])
      ).filter((event) => pubkeys.includes(event.pubkey)),
    );
    const missing = pubkeys.filter((pubkey) => !found.has(pubkey));
    return {
      npubs: pubkeys.flatMap((pubkey) => found.get(pubkey)?.npub ?? []),
      accounts: pubkeys.flatMap((pubkey) => found.get(pubkey)?.account ?? []),
      missing,
    };
  }

  const noMarmotId = (who) =>
    `No Marmot ID yet for ${who}. They need the Marmot chats plugin installed and Buzz open once, so it can publish their Marmot ID.`;

  /** `pubkey`'s Buzz profile from the community's people directory. */
  async function buzzPerson(pubkey, signal) {
    const relay = relaySession();
    try {
      const found = await relay?.directMessages?.people?.(pubkey, 1, signal);
      const person = found?.people?.find((p) => p.pubkey === pubkey);
      if (person) return { person, known: true };
    } catch {}
    const profile = relay?.profiles?.snapshot?.()?.get(pubkey);
    return { person: { ...profile, pubkey, name: profile?.name ?? "" }, known: !!profile };
  }

  /** Who a pasted key names: a Buzz person with a Marmot ID (by their Buzz
   * key, or by the Marmot ID their binding names), else a bare Marmot
   * account with a KeyPackage on the Marmot relays. `note` explains an empty
   * result. */
  async function resolveKey(key, signal) {
    const me = viewer();
    if (key === me || key === store.get().account?.id) return { people: [], note: "That’s you." };
    const bound = await lookupBindings([key]);
    if (bound.error) return { people: [], note: bound.error };
    if (bound.npubs.length) return { people: [(await buzzPerson(key, signal)).person] };
    await loadDirectory();
    const owner = store.get().directory[key];
    if (owner === me) return { people: [], note: "That’s you." };
    if (owner) return { people: [(await buzzPerson(owner, signal)).person] };
    const checked = (await session?.checkKey(key)) ?? { error: "Marmot is not ready yet." };
    if (checked.npub)
      return { people: [{ pubkey: key, marmot: checked.npub, name: `Marmot ID ${checked.npub.slice(0, 12)}…` }] };
    const buzz = await buzzPerson(key, signal);
    if (buzz.known) return { people: [], note: noMarmotId(buzz.person.name || shortKey(key)) };
    return {
      people: [],
      note: checked.error ? `Could not check this key: ${checked.error}` : "No Marmot account found for this key.",
    };
  }

  /** The active community's chat with exactly these other Marmot accounts:
   * like a DM, a New chat to the same people continues it. */
  function existingChat(accounts, community) {
    const state = store.get();
    const wanted = [...new Set(accounts)].sort().join();
    if (!wanted || !community) return null;
    const invited = new Set(state.invites.map((invite) => invite.id));
    return (
      state.chats.find(
        (chat) =>
          !chat.pending &&
          !invited.has(chat.id) &&
          chat.community === community &&
          [...new Set(state.members[chat.id] ?? [])].sort().join() === wanted,
      ) ?? null
    );
  }

  function syncIdentity() {
    const home = homeFor(viewer());
    void ensureBinding();
    // A reconnecting relay can briefly report no viewer; keep the session.
    if (!home || home === sessionHome) return;
    session?.stop();
    sessionHome = home;
    boundFor = null;
    store.set({ ...INITIAL, selected: store.get().selected });
    session = createSession(ctx.host, home, store, {
      ready() {
        void ensureBinding();
        void loadDirectory();
      },
      poll() {
        void ensureBinding();
        void loadDirectory();
      },
      author(from) {
        if (from && !store.get().directory[from]) void loadDirectory();
      },
    });
  }

  ctx.effect(() => {
    syncIdentity();
    const unsubscribe = ctx.relay.subscribe(syncIdentity);
    return () => {
      unsubscribe();
      session?.stop();
      session = null;
      sessionHome = null;
    };
  });

  const useStore = () =>
    React.useSyncExternalStore(store.subscribe, store.get);
  const useRelaySession = () =>
    React.useSyncExternalStore(ctx.relay.subscribe, relaySession);
  const pageTarget = (params) => ({
    version: 1,
    kind: "page",
    pluginId: PLUGIN_ID,
    pageId: PAGE_ID,
    route: { version: 1, params },
  });

  const emptyProfiles = new Map();
  const noProfiles = () => emptyProfiles;
  const noSubscribe = () => () => {};

  /** Buzz profiles for `pubkeys`, fetched on demand. */
  function useProfiles(relay, pubkeys) {
    const profiles = relay?.profiles;
    const map = React.useSyncExternalStore(
      profiles?.subscribe ?? noSubscribe,
      profiles?.snapshot ?? noProfiles,
    );
    const wanted = pubkeys.filter((key) => HEX_KEY.test(key)).join(":");
    React.useEffect(() => {
      if (wanted) void profiles?.ensure?.(wanted.split(":"))?.catch?.(() => {});
    }, [profiles, wanted]);
    return map;
  }

  async function copy(text) {
    await navigator.clipboard?.writeText(text);
  }

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

  // ---- presentation: Buzz markup and tokens ---------------------------------

  function Svg({ size = "1em", strokeWidth = 2, children, style }) {
    return h(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
        style: { flex: "none", ...style },
      },
      children,
    );
  }
  const LockIcon = ({ size, style }) =>
    h(
      Svg,
      { size, style },
      h("rect", { x: 4, y: 11, width: 16, height: 10, rx: 2 }),
      h("path", { d: "M8 11V7a4 4 0 0 1 8 0v4" }),
    );
  // The sidebar header's "+" and "…": Buzz's Tabler glyphs at its 15px / 2.5.
  const PlusIcon = () =>
    h(Svg, { size: 15, strokeWidth: 2.5 }, h("path", { d: "M12 5l0 14M5 12l14 0" }));
  const DotsIcon = () =>
    h(
      Svg,
      { size: 15, strokeWidth: 2.5 },
      h("path", { d: "M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" }),
    );
  const ChatIcon = () =>
    h(
      Svg,
      { size: "1.5rem" },
      h("path", {
        d: "M4 19.5 5.3 15A8 8 0 1 1 9 18.7z",
      }),
    );

  /** Buzz's Avatar markup (`.buzz-avatar`), so host styles size and tint it. */
  function Avatar({ name, src, size = "default" }) {
    const [loaded, setLoaded] = React.useState(null);
    const initial = Array.from((name ?? "").trim())[0]?.toUpperCase() || "?";
    return h(
      "span",
      { className: "buzz-avatar-status", "data-size": size, "data-shape": "circle" },
      h(
        "span",
        {
          "data-buzz-ui": "",
          className: "buzz-avatar",
          "data-size": size,
          "data-avatar-shape": "circle",
          "data-fallback-surface": "subtle",
          "aria-hidden": true,
        },
        src &&
          h("img", {
            key: src,
            src,
            alt: "",
            "data-loaded": loaded === src ? "true" : undefined,
            onLoad: () => setLoaded(src),
            onError: () => setLoaded(null),
          }),
        (!src || loaded !== src) &&
          h("span", { "aria-hidden": true, "data-avatar-fallback": "" }, initial),
      ),
    );
  }

  /** Buzz's small AvatarStack, as a conversation header shows its members. */
  function AvatarStack({ people }) {
    return h(
      "span",
      {
        className: "text-caption",
        "aria-hidden": true,
        style: {
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          whiteSpace: "nowrap",
          isolation: "isolate",
          paddingInlineEnd: "var(--space-1)",
        },
      },
      people.slice(0, 3).map((person, index) =>
        h(
          "span",
          {
            key: person.id,
            title: person.name,
            style: {
              position: "relative",
              zIndex: index + 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              width: "1.5rem",
              height: "1.5rem",
              padding: "1.5px",
              marginInlineEnd: "calc(-1 * var(--space-1))",
              overflow: "hidden",
              borderRadius: "var(--radius-pill)",
              background: "var(--surface-panel)",
            },
          },
          h(Avatar, { name: person.name, src: person.src, size: "fill" }),
        ),
      ),
    );
  }

  /** Buzz's EmptyState markup (`.buzz-empty-state`). */
  function EmptyState({ title, description }) {
    return h(
      "div",
      { "data-buzz-ui": "", className: "buzz-empty-state" },
      h(
        "div",
        { className: "buzz-empty-state-content" },
        h("span", { className: "buzz-empty-state-icon", "aria-hidden": true }, h(ChatIcon)),
        h(
          "div",
          { className: "buzz-empty-state-copy" },
          h("h3", { className: "buzz-empty-state-title" }, title),
          description &&
            h("p", { className: "buzz-empty-state-description" }, description),
        ),
      ),
    );
  }

  function Button({ variant = "subtle", loading, ...props }) {
    const Host = kit()?.Button;
    if (Host) return h(Host, { variant, size: "sm", loading, ...props });
    return h("button", { type: "button", ...props });
  }

  const subtle = { color: "var(--text-subtle)" };
  const danger = { color: "var(--text-danger)" };
  const warning = { color: "var(--text-warning)" };
  // NewMessage.module.css `.page`, `.blank` and `.feedback`.
  const pageStyle = {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
  };
  const feedbackStyle = { ...subtle, paddingInline: "var(--space-6)" };
  // Channels.module.css `.root`: the frame every Buzz conversation sits in.
  const rootStyle = {
    height: "100%",
    minHeight: 0,
    containerType: "inline-size",
    color: "var(--text-standard)",
    fontSize: "var(--text-body-sm)",
    lineHeight: "var(--text-body-sm--line-height)",
    letterSpacing: "var(--text-body-sm--letter-spacing)",
  };
  const columnStyle = {
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  function Status({ state }) {
    if (state.phase === "failed")
      return h(
        "div",
        {
          className: "text-body-sm",
          style: {
            padding: "var(--space-6)",
            display: "grid",
            gap: "var(--space-2)",
            maxWidth: "40rem",
          },
        },
        h("h2", null, "Encrypted chats are not available"),
        h("p", { style: danger }, errorText(state.error)),
        h(
          "p",
          { style: subtle },
          "Check that `wn` and `wnd` are on Buzz's search path (~/.local/bin, Homebrew, or your login shell PATH) and that a Marmot relay is reachable: ",
          MARMOT_RELAYS.join(", "),
          ".",
        ),
        state.home && h("p", { style: subtle }, `Home: ${state.home}`),
        h(
          "div",
          null,
          h(
            Button,
            {
              variant: "prominent",
              onClick: () => {
                sessionHome = null;
                syncIdentity();
              },
            },
            "Try again",
          ),
        ),
      );
    return h(
      "p",
      {
        role: "status",
        className: "text-body-sm",
        style: { ...subtle, padding: "var(--space-8) var(--space-4)" },
      },
      state.step || "Loading…",
    );
  }

  // ---- New chat: Buzz's New message view -------------------------------------

  /** The "To:" bar of Buzz's New message view, searching Buzz's people
   * directory (`session.directMessages.people`). */
  function ToField({ relay, state, selected, onChange, disabled, onTyped, onComplete }) {
    const [query, setQuery] = React.useState("");
    const [open, setOpen] = React.useState(true);
    const [result, setResult] = React.useState({ people: [], loading: true, note: "" });
    const [active, setActive] = React.useState(0);
    const input = React.useRef(null);
    const me = viewer();
    const bound = React.useMemo(
      () => new Set(Object.values(state.directory)),
      [state.directory],
    );
    React.useEffect(() => {
      onTyped(!!query.trim());
    }, [query]);
    React.useEffect(() => {
      if (!open) return;
      const controller = new AbortController();
      const typed = query.trim();
      const key = typedKey(typed);
      const timer = setTimeout(async () => {
        setResult((current) => ({ ...current, loading: true, note: "", lookup: !!key }));
        try {
          let found;
          if (key) found = await resolveKey(key, controller.signal);
          else if (/^(nostr:)?npub1/i.test(typed))
            found = { people: [], note: "Paste a whole npub or 64-character hex key." };
          else if (typed.length > PEOPLE_SEARCH_MAX_LENGTH) found = { people: [] };
          else {
            const read = relay?.directMessages?.people;
            if (typeof read === "function") {
              found = { people: (await read(typed, 1, controller.signal)).people ?? [] };
            } else {
              const wanted = typed.toLowerCase();
              found = {
                people: [...(relay?.profiles?.snapshot?.() ?? emptyProfiles)]
                  .map(([pubkey, profile]) => ({ ...profile, pubkey }))
                  .filter((person) => (person.name ?? "").toLowerCase().includes(wanted)),
              };
            }
          }
          if (controller.signal.aborted) return;
          setResult({ people: found.people, loading: false, note: found.note ?? "" });
          setActive(0);
        } catch {
          // Buzz's search errors are its own wording; an empty list says enough.
          if (!controller.signal.aborted) setResult({ people: [], loading: false, note: "" });
        }
      }, typed ? 150 : 0);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }, [relay, query, open]);
    const picked = new Set(selected.map((person) => person.pubkey));
    const options = result.people.filter(
      (person) => person.pubkey !== me && !picked.has(person.pubkey) && !person.isAgent,
    );
    const pick = (person) => {
      onChange([...selected, person]);
      setQuery("");
      setOpen(false);
      onComplete();
    };
    const remove = (pubkey) => {
      onChange(selected.filter((person) => person.pubkey !== pubkey));
      input.current?.focus();
    };
    const onKeyDown = (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
        setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter" && open && options[active]) {
        event.preventDefault();
        pick(options[active]);
      } else if (event.key === "Escape") {
        setOpen(false);
      } else if (event.key === "Backspace" && !query && selected.length) {
        remove(selected.at(-1).pubkey);
      }
    };
    const id = "marmot-new-chat-to";
    return h(
      "div",
      {
        style: {
          margin: 0,
          minWidth: 0,
          position: "relative",
          zIndex: 3,
          padding: "var(--space-4) var(--space-6)",
          borderBottom: "1px solid var(--border-standard)",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            minHeight: "2rem",
            cursor: "text",
          },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              input.current?.focus();
            }
          },
        },
        h(
          "label",
          {
            htmlFor: id,
            className: "text-body-sm",
            style: { ...subtle, marginRight: "var(--space-1)" },
          },
          "To:",
        ),
        selected.map((person) =>
          h(
            "span",
            {
              key: person.pubkey,
              className: "text-body-sm",
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding:
                  "var(--space-chip-inset) var(--space-2) var(--space-chip-inset) var(--space-chip-inset)",
                maxWidth: "15rem",
                borderRadius: "var(--radius-pill)",
                background: "var(--surface-inset)",
              },
            },
            h(Avatar, {
              name: person.name,
              src: avatarSrc(relay, person.picture),
              size: "small",
            }),
            h(
              "span",
              { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              person.name || shortKey(person.pubkey),
            ),
            h(
              "button",
              {
                type: "button",
                disabled,
                "aria-label": `Remove ${person.name || "person"}`,
                onClick: () => remove(person.pubkey),
                style: {
                  display: "grid",
                  placeItems: "center",
                  width: "1.375rem",
                  height: "1.375rem",
                  border: 0,
                  padding: 0,
                  borderRadius: "var(--radius-pill)",
                  background: "transparent",
                  color: "var(--text-subtle)",
                  cursor: "pointer",
                },
              },
              "×",
            ),
          ),
        ),
        h("input", {
          ref: input,
          id,
          autoFocus: true,
          autoComplete: "off",
          role: "combobox",
          "aria-expanded": open,
          "aria-controls": `${id}-people`,
          disabled,
          value: query,
          placeholder: selected.length ? "" : "Find a person…",
          className: "text-body-sm",
          onChange: (event) => {
            setQuery(event.target.value);
            setOpen(true);
          },
          onFocus: () => setOpen(true),
          onBlur: () => setTimeout(() => setOpen(false), 120),
          onKeyDown,
          style: {
            flex: 1,
            minWidth: "8.75rem",
            width: "8.75rem",
            padding: "var(--space-1) 0",
            border: 0,
            outline: "none",
            background: "transparent",
            color: "var(--text-standard)",
          },
        }),
        h(
          "span",
          {
            title: "End-to-end encrypted with Marmot",
            "data-testid": "marmot-encrypted",
            style: { ...subtle, display: "inline-flex", marginInlineStart: "auto" },
          },
          h(LockIcon, { size: "0.875rem" }),
        ),
      ),
      open &&
        !disabled &&
        h(
          "div",
          {
            id: `${id}-people`,
            role: "listbox",
            "aria-label": "People",
            style: {
              position: "absolute",
              top: "calc(100% - var(--space-2))",
              insetInlineStart: "var(--space-6)",
              width: "min(23.75rem, calc(100% - 2 * var(--space-6)))",
              maxHeight: "min(25rem, 50vh)",
              overflowY: "auto",
              overscrollBehavior: "contain",
              padding: "var(--space-1)",
              borderRadius: "var(--radius-floating, var(--radius-card))",
              border: "1px solid var(--border-standard)",
              background: "var(--surface-popover)",
              boxShadow: "var(--shadow-lg, var(--shadow-md))",
              color: "var(--text-standard)",
              zIndex: "var(--layer-popover)",
            },
          },
          options.map((person, index) =>
            h(
              "div",
              {
                key: person.pubkey,
                role: "option",
                "aria-selected": index === active,
                onMouseDown: (event) => {
                  event.preventDefault();
                  pick(person);
                },
                onMouseEnter: () => setActive(index),
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-row-gap, var(--space-2))",
                  minHeight: "var(--size-row)",
                  padding: "var(--space-1) var(--space-control-inset)",
                  borderRadius: "var(--radius-row)",
                  cursor: "pointer",
                  background:
                    index === active ? "var(--affordance-subtle-hover)" : "transparent",
                },
              },
              h(Avatar, { name: person.name, src: avatarSrc(relay, person.picture) }),
              h(
                "span",
                {
                  className: "text-body-sm",
                  style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                },
                person.name || shortKey(person.pubkey),
              ),
              bound.has(person.pubkey) &&
                h(
                  "span",
                  { title: "Has a Marmot ID", style: { ...subtle, display: "inline-flex" } },
                  h(LockIcon, { size: "0.75rem" }),
                ),
            ),
          ),
          !options.length &&
            h(
              "p",
              { className: "text-body-sm", style: { ...subtle, padding: "var(--space-3)", margin: 0 } },
              result.note ||
                (result.loading
                  ? result.lookup
                    ? "Looking up this key…"
                    : "Searching people…"
                  : "No people found."),
            ),
        ),
    );
  }

  /** Buzz's New message view, whose first message creates the encrypted group. */
  function NewChat({ state, relay }) {
    const [recipients, setRecipients] = React.useState([]);
    const [typed, setTyped] = React.useState(false);
    const [busy, setBusy] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [focus, setFocus] = React.useState(0);
    const profiles = useProfiles(relay, recipients.map((person) => person.pubkey));
    const recipientNames = recipients
      .map((person) => (person.marmot ? person.name : personName(profiles, person.pubkey) || person.name))
      .join(", ");
    const ready = state.phase === "ready" && !!relay;
    const marmotOf = React.useMemo(
      () => new Map(Object.entries(state.directory).map(([marmot, buzz]) => [buzz, marmot])),
      [state.directory],
    );
    const accounts = recipients.map((person) => (person.marmot ? person.pubkey : marmotOf.get(person.pubkey)));
    const continuing =
      recipients.length && accounts.every(Boolean) ? existingChat(accounts, activeCommunity()) : null;
    // An error names the people it was about; new recipients clear it.
    React.useEffect(() => setError(null), [recipients]);
    const send = async (draft) => {
      const content = (draft?.text ?? "").trim();
      if (!content) return;
      setError(null);
      setBusy("Looking up Marmot IDs…");
      try {
        const community = activeCommunity();
        if (!community) throw new Error("Buzz is not connected to a community yet.");
        const raw = recipients.filter((person) => person.marmot);
        const people = recipients.filter((person) => !person.marmot);
        const found = people.length
          ? await lookupBindings(people.map((person) => person.pubkey))
          : { npubs: [], accounts: [], missing: [] };
        if (found.error) throw new Error(found.error);
        if (found.missing.length) {
          const who = people
            .filter((person) => found.missing.includes(person.pubkey))
            .map((person) => person.name || shortKey(person.pubkey))
            .join(", ");
          throw new Error(noMarmotId(who));
        }
        const existing = existingChat(
          [...found.accounts, ...raw.map((person) => person.pubkey)],
          community,
        );
        if (existing) {
          setBusy("Sending message…");
          const problem = await session?.send(existing.id, content);
          if (problem !== null) throw new Error(problem ?? "Marmot is not ready yet.");
          await ctx.navigation.open(pageTarget({ chat: existing.id }));
          return;
        }
        setBusy("Creating the encrypted chat and sending invites…");
        const created = await session?.createChat(
          recipientNames.slice(0, 80) || "Encrypted chat",
          [...found.npubs, ...raw.map((person) => person.marmot)],
          community,
        );
        if (!created) throw new Error("Marmot is not ready yet.");
        if (created.error) throw new Error(created.error);
        setBusy("Sending message…");
        const problem = await session.send(created.groupId, content);
        if (problem) throw new Error(problem);
        if (created.warning) store.set({ notice: created.warning });
        await ctx.navigation.open(pageTarget({ chat: created.groupId }));
      } catch (failed) {
        setError(String(failed?.message ?? failed));
      } finally {
        setBusy(null);
      }
    };
    if (!ready) return h(Status, { state });
    return h(
      "section",
      { style: pageStyle, "aria-label": "New encrypted chat" },
      h(ToField, {
        relay,
        state,
        selected: recipients,
        onChange: setRecipients,
        disabled: !!busy,
        onTyped: setTyped,
        onComplete: () => setFocus((n) => n + 1),
      }),
      h("div", {
        style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
      }),
      (busy || error || continuing) &&
        h(
          "div",
          { className: "text-body-sm", style: feedbackStyle },
          continuing &&
            !busy &&
            !error &&
            h(
              "p",
              { "data-testid": "marmot-continuing", style: { ...subtle, marginBlock: "var(--space-2)" } },
              "You already have an encrypted chat with them in this community. Your message continues it.",
            ),
          busy && h("p", { role: "status", style: { marginBlock: "var(--space-2)" } }, busy),
          error &&
            h("p", { role: "alert", style: { ...danger, marginBlock: "var(--space-2)" } }, error),
        ),
      ui.Composer &&
        h(ui.Composer, {
          session: relay,
          scope: relay.scope,
          channelId: "marmot:new",
          channelName: recipientNames || "new message",
          label: recipientNames ? `Message ${recipientNames}` : "New message",
          placeholder: recipientNames ? undefined : "",
          focusRequest: focus,
          disabled: !recipients.length,
          submission: {
            draftKey: "marmot.chats:new",
            locked: !!busy,
            disabled: !ready || !!busy || !recipients.length || typed,
            submit: (draft) => void send(draft),
          },
        }),
    );
  }

  // ---- conversation: Buzz's DM / group view ----------------------------------

  /** Invite in place of the composer, sized like the composer it replaces. */
  function Invite({ chat }) {
    const [busy, setBusy] = React.useState(null);
    const [error, setError] = React.useState(null);
    const act = async (kind) => {
      setBusy(kind);
      setError(null);
      const problem = session
        ? await (kind === "accept" ? session.accept(chat.id) : session.decline(chat.id))
        : "Not ready";
      setBusy(null);
      if (problem) setError(problem);
    };
    return h(
      "div",
      {
        className: "text-body-sm",
        style: {
          boxSizing: "border-box",
          width: "min(calc(100% - 2 * var(--space-4)), var(--buzz-message-width, 52rem))",
          margin: "0 auto var(--space-4)",
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--space-2)",
          padding: "var(--space-3)",
          border: "1px solid var(--border-standard)",
          borderRadius: "calc(var(--radius-icon-button) + var(--space-1h) + 1px)",
          background: "var(--surface-composer)",
          boxShadow: "var(--shadow-xs)",
        },
      },
      h("span", { style: { ...subtle, flex: 1 } }, "You were invited to this encrypted chat."),
      h(
        Button,
        {
          variant: "prominent",
          disabled: !!busy,
          loading: busy === "accept",
          onClick: () => act("accept"),
        },
        "Accept",
      ),
      h(Button, { disabled: !!busy, onClick: () => act("decline") }, "Decline"),
      error && h("p", { role: "alert", style: { ...danger, flexBasis: "100%" } }, error),
    );
  }

  const sameDay = (a, b) =>
    new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();
  const stacks = (previous, current) =>
    !!previous &&
    !!current &&
    previous.authorId === current.authorId &&
    current.createdAt >= previous.createdAt &&
    current.createdAt - previous.createdAt <= STACK_SECONDS &&
    sameDay(previous.createdAt, current.createdAt);
  const noLink = () => false;
  const noMedia = () => undefined;

  /** Messages.module.css `.feed`, `.edge`, the centered `ol` and `.timelineEnd`. */
  function Timeline({ rows, profiles, relay, me, loading, empty }) {
    const scroller = React.useRef(null);
    const pinned = React.useRef(true);
    const last = rows.at(-1)?.id;
    React.useLayoutEffect(() => {
      const node = scroller.current;
      if (node && pinned.current) node.scrollTop = node.scrollHeight;
    }, [last, rows.length]);
    return h(
      "section",
      {
        ref: scroller,
        "aria-label": "Channel history",
        tabIndex: -1,
        "data-message-scroller": "",
        onScroll: ({ currentTarget: node }) => {
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8;
        },
        style: {
          "--message-hover-inset": "var(--space-panel-inset)",
          "--timeline-measure": "var(--buzz-message-width, 52rem)",
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowAnchor: "none",
          padding: "0 var(--space-panel-inset)",
          paddingBottom: "var(--space-half)",
          outline: "none",
        },
      },
      h("div", {
        style: {
          width: "min(100%, var(--timeline-measure))",
          marginInline: "auto",
          minHeight: "var(--space-4)",
        },
      }),
      loading &&
        h(
          "p",
          { role: "status", className: "text-body-sm", style: { ...subtle, textAlign: "center" } },
          "Loading messages…",
        ),
      !loading &&
        !rows.length &&
        h("div", { style: { paddingBlock: "var(--space-panel-inset)" } }, empty),
      rows.length > 0 &&
        h(
          "ol",
          {
            style: {
              listStyle: "none",
              padding: 0,
              margin: "0 auto",
              width: "min(100%, var(--timeline-measure))",
            },
          },
          rows.map((row, index) =>
            h(
              "li",
              { key: row.id },
              // No `session` or `scope`: the rows stay read-only, so no reaction,
              // edit, report or read-state write can reach the Buzz relay.
              h(ui.Message, {
                row,
                profile: profiles.get(row.authorId),
                participantProfiles: profiles,
                references: relay,
                viewer: me,
                media: relay?.media ?? noMedia,
                onOpenLink: noLink,
                retry: undefined,
                layout: "timeline",
                day: index === 0 || !sameDay(rows[index - 1].createdAt, row.createdAt),
                stackPrevious: stacks(rows[index - 1], row),
                stackNext: stacks(row, rows[index + 1]),
              }),
            ),
          ),
        ),
      h("div", { "aria-hidden": true, style: { height: "var(--space-8)" } }),
    );
  }

  /** ChannelHeaderIdentity: member avatars, then the name. */
  function Identity({ title, people }) {
    return h(
      "span",
      {
        "data-testid": "marmot-identity",
        style: {
          display: "inline-flex",
          alignItems: "center",
          maxWidth: "100%",
          minWidth: 0,
          gap: "var(--space-2)",
          padding: "0 var(--space-2)",
          color: "var(--text-standard)",
        },
      },
      h(
        "span",
        { "aria-hidden": true, style: { position: "relative", zIndex: 1, display: "flex", alignItems: "center" } },
        h(AvatarStack, { people }),
      ),
      h(
        "span",
        {
          className: "text-body-sm",
          style: {
            display: "flex",
            alignItems: "center",
            minHeight: "var(--size-control-sm)",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        title,
      ),
    );
  }

  const INFO_TITLE = "Encrypted messages (experimental)";
  const INFO_LABEL = "About encrypted messages";
  const InfoIcon = () =>
    h(
      Svg,
      { size: 16 },
      h("path", { d: "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 9h.01M11 12h1v4h1" }),
    );

  /**
   * The header's ⓘ: the host Button as DM header IconButtons render it (ghost,
   * toolbar size; IconButton is not offered to plugins, so its data-icon-*
   * attributes are added here), opening a popover in Buzz's popover markup.
   */
  function InfoButton({ relay }) {
    const [open, setOpen] = React.useState(false);
    const [closing, setClosing] = React.useState(false);
    const [settled, setSettled] = React.useState(false);
    const wrap = React.useRef(null);
    const popup = React.useRef(null);
    const titleId = React.useId();
    const button = () => wrap.current?.querySelector("button");
    const close = React.useCallback((focusButton) => {
      setClosing(true);
      if (focusButton) button()?.focus({ preventScroll: true });
      setTimeout(() => {
        setOpen(false);
        setClosing(false);
        setSettled(false);
      }, 120);
    }, []);
    React.useLayoutEffect(() => {
      const control = button();
      if (!control) return;
      control.setAttribute("data-icon-variant", "ghost");
      control.setAttribute("data-icon-size", "toolbar");
      control.setAttribute("data-icon-shape", "control");
      control.setAttribute("aria-haspopup", "dialog");
      control.setAttribute("aria-expanded", String(open && !closing));
    });
    React.useEffect(() => {
      if (!open || closing) return undefined;
      popup.current?.focus({ preventScroll: true });
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
      const outside = (event) => {
        if (!wrap.current?.contains(event.target)) close(false);
      };
      const keydown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      };
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", keydown, true);
      return () => {
        cancelAnimationFrame(frame);
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", keydown, true);
      };
    }, [open, closing, close]);
    const Markdown = ui.Markdown;
    const contribute = `[Contribute on GitHub](${PLUGIN_REPO_URL})`;
    return h(
      "span",
      { ref: wrap, "data-testid": "marmot-info", style: { position: "relative", display: "inline-flex" } },
      h(Button, {
        variant: "ghost",
        "aria-label": INFO_LABEL,
        title: INFO_LABEL,
        onClick: () => (open ? close(false) : setOpen(true)),
        children: h(InfoIcon),
      }),
      open &&
        h(
          "div",
          {
            ref: popup,
            role: "dialog",
            "aria-labelledby": titleId,
            tabIndex: -1,
            className: "buzz-popover-popup text-body",
            "data-buzz-ui": "",
            "data-size": "default",
            "data-padding": "content",
            "data-side": "bottom",
            ...(closing ? { "data-ending-style": "" } : settled ? {} : { "data-starting-style": "" }),
            style: {
              position: "absolute",
              top: "calc(100% + var(--space-2))",
              right: 0,
              zIndex: "var(--layer-popover)",
              "--transform-origin": "top right",
              "--available-height": "70vh",
              "--available-width": "calc(100vw - var(--space-4))",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              outline: "none",
              textAlign: "start",
            },
          },
          h("h2", { id: titleId, className: "buzz-popover-title text-label", style: { margin: 0 } }, INFO_TITLE),
          ...[
            "These chats are end-to-end encrypted with Marmot (MLS over Nostr), using MDK. Messages travel through Marmot relays, not the Buzz relay.",
            "It’s experimental: expect rough edges, and don’t rely on it for anything critical yet.",
            "Please don’t use Forward on encrypted messages. It sends them again as plain text.",
          ].map((text) =>
            h("p", { key: text, className: "buzz-popover-description text-body-sm", style: { margin: 0, ...subtle } }, text),
          ),
          h(
            "div",
            { className: "text-body-sm", "data-testid": "marmot-contribute" },
            Markdown
              ? h(Markdown, { content: contribute, session: relay ?? undefined })
              : h("a", { href: PLUGIN_REPO_URL, target: "_blank", rel: "noreferrer" }, "Contribute on GitHub"),
          ),
        ),
    );
  }

  /** One encrypted conversation in Buzz's tab workspace, rows and composer. */
  function Conversation({ state, chat, relay }) {
    const messages = state.messages[chat.id];
    const me = viewer();
    const rows = React.useMemo(
      () =>
        (messages ?? []).map((message) => ({
          id: message.id,
          channelId: `marmot:${chat.id}`,
          authorId: message.own ? me : buzzOf(state, message.from),
          createdAt: message.at,
          content: message.text,
          mentions: [],
          attachments: [],
          reactions: [],
          replyCount: 0,
          participants: [],
        })),
      [messages, chat.id, me, state.directory],
    );
    const memberKeys = (state.members[chat.id] ?? []).map((member) => buzzOf(state, member));
    const profiles = useProfiles(relay, [
      ...new Set([...rows.map((row) => row.authorId), ...memberKeys, ...(me ? [me] : [])]),
    ]);
    const title = chatTitle(state, chat, profiles);
    const people = [...memberKeys, ...(me ? [me] : [])].map((pubkey) => ({
      id: pubkey,
      name: personName(profiles, pubkey),
      src: avatarSrc(relay, profiles.get(pubkey)?.picture),
    }));
    people.sort((a, b) => Number(!!b.src) - Number(!!a.src));
    const invited = chat.pending || state.invites.some((invite) => invite.id === chat.id);
    const lastOwn = [...(messages ?? [])].reverse().find((m) => m.own)?.id;
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);
    const send = async (draft) => {
      const content = (draft?.text ?? "").trim();
      if (!content || !session) return;
      setBusy(true);
      setError(null);
      const problem = await session.send(chat.id, content);
      setBusy(false);
      if (problem) setError(problem);
    };
    const body = h(
      "div",
      { style: columnStyle },
      h(
        "div",
        { style: { display: "flex", flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0 } },
        h(Timeline, {
          rows,
          profiles,
          relay,
          me,
          loading: messages === undefined,
          empty: h(EmptyState, {
            title: "No messages yet.",
            description: invited
              ? "Accept the invite to read and send messages."
              : "Start the conversation below.",
          }),
        }),
        state.notice &&
          h("p", { className: "text-body-sm", style: { ...feedbackStyle, ...warning } }, state.notice),
        error &&
          h("p", { role: "alert", className: "text-body-sm", style: { ...feedbackStyle, ...danger } }, error),
        invited
          ? h(Invite, { chat })
          : relay &&
              messages !== undefined &&
              h(ui.Composer, {
                session: relay,
                scope: relay.scope,
                channelId: `marmot:${chat.id}`,
                channelName: title,
                label: `Message ${title}`,
                submission: {
                  // A new own message moves the key, which clears the composer.
                  draftKey: `marmot.chats:${chat.id}:${lastOwn ?? "first"}`,
                  locked: busy,
                  disabled: busy,
                  submit: (draft) => void send(draft),
                },
              }),
      ),
    );
    const Workspace = ctx.panels?.ui?.Workspace;
    return h(
      "div",
      { style: rootStyle, "aria-label": `Encrypted chat ${title}`, role: "region" },
      h(
        "div",
        { style: columnStyle },
        Workspace
          ? h(Workspace, {
              main: true,
              label: "Encrypted chat tabs",
              focusOnMount: false,
              value: "conversation",
              select: () => {},
              identity: h(Identity, { title, people }),
              actions: h(InfoButton, { relay }),
              items: [
                {
                  id: "conversation",
                  label: title,
                  icon: h(LockIcon, { size: "1rem" }),
                  content: body,
                },
              ],
            })
          : body,
      ),
    );
  }

  function MarmotPage({ navigation }) {
    const state = useStore();
    const relay = useRelaySession();
    const { untagged } = React.useSyncExternalStore(prefs.subscribe, prefs.get);
    const community = React.useSyncExternalStore(ctx.relay.subscribe, activeCommunity);
    const params =
      navigation?.target?.kind === "page" ? navigation.target.route?.params : undefined;
    const routeChat = typeof params?.chat === "string" ? params.chat : null;
    const chat = routeChat
      ? (state.chats.find((c) => c.id === routeChat) ??
        state.invites.find((c) => c.id === routeChat))
      : null;
    const hidden = !!chat && !inView(chat, community, untagged);
    React.useEffect(() => {
      if (routeChat && !hidden) void session?.openChat(routeChat);
      else session?.closeChat();
    }, [routeChat, navigation?.entryId, state.phase, hidden]);
    // Leaving the page stops reading the chat; returning to the window reads it.
    React.useEffect(() => () => session?.closeChat(), []);
    React.useEffect(() => {
      if (!routeChat) return undefined;
      const seen = () => {
        if (session?.viewing(routeChat)) void session.markRead(routeChat);
      };
      document.addEventListener("visibilitychange", seen);
      return () => document.removeEventListener("visibilitychange", seen);
    }, [routeChat]);
    let content;
    if (state.phase !== "ready") content = h(Status, { state });
    else {
      content = chat
        ? !hidden
          ? h(Conversation, { key: chat.id, state, chat, relay })
          : h(EmptyState, {
              title: "This encrypted chat belongs to another community.",
              description: chat.community
                ? `Switch to ${chat.community.replace(/^wss?:\/\//, "")} to open it, or turn on Show untagged chats in the Encrypted messages menu.`
                : "It has no community tag. Turn on Show untagged chats in the Encrypted messages menu to open it.",
            })
        : routeChat
          ? h(Status, { state: { ...state, step: "Opening the chat…" } })
          : h(NewChat, { state, relay });
    }
    return h("div", { style: rootStyle }, content);
  }

  ctx.pages.register({
    id: PAGE_ID,
    title: "Encrypted chats",
    icon: lockSvg,
    // The Encrypted sidebar section is the way in; without one, a nav entry.
    primary: !sidebarSections,
    layout: "workspace",
    conversationNavigation: true,
    route: {
      version: 1,
      validate: (params) =>
        !!params &&
        typeof params === "object" &&
        (params.new === true
          ? Object.keys(params).length === 1
          : typeof params.chat === "string" &&
            HEX.test(params.chat) &&
            params.chat.length <= 128),
    },
    component: MarmotPage,
  });

  // ---- Settings: the Marmot ID card ----------------------------------------

  function bindingText(state) {
    if (state.binding === "published")
      return "Linked to your Buzz ID: people in this community can start encrypted chats with you.";
    if (state.binding === "unsupported")
      return "This Buzz build cannot publish your Marmot ID, so others cannot invite you by name yet.";
    if (state.binding === "failed")
      return `Could not publish your Marmot ID: ${state.bindingError}`;
    return "Not linked to your Buzz ID yet.";
  }

  const abbreviated = (npub) => `${npub.slice(0, 12)}…${npub.slice(-6)}`;

  /** Buzz's Identity card front (IdentityBadge), for the Marmot key. */
  function MarmotIdCard({ state, profile }) {
    const [copied, setCopied] = React.useState(false);
    const name = profile?.name || "Marmot";
    const picture = profile?.picture;
    const [loaded, setLoaded] = React.useState(null);
    const npub = state.account?.npub;
    return h(
      "div",
      {
        "data-testid": "marmot-id-card",
        style: {
          display: "grid",
          justifyItems: "center",
          gap: "var(--space-3)",
          width: "100%",
          textAlign: "center",
          padding: "var(--space-4)",
          boxSizing: "border-box",
        },
      },
      h(
        "div",
        {
          style: {
            position: "relative",
            overflow: "hidden",
            width: "min(100%, 20rem)",
            border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-card)",
            background: "var(--surface-inset)",
            color: "var(--text-primary)",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
          },
        },
        h(
          "div",
          { style: { position: "relative", width: "100%", aspectRatio: "1", overflow: "hidden" } },
          (!picture || loaded !== picture) &&
            h(
              "span",
              {
                "aria-hidden": true,
                style: {
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: "6rem",
                  fontWeight: 700,
                  color: "var(--text-subtle)",
                  background: "var(--affordance-subtle)",
                },
              },
              name.trim().slice(0, 1).toUpperCase() || "?",
            ),
          picture &&
            h("img", {
              src: picture,
              alt: "",
              onLoad: () => setLoaded(picture),
              onError: () => setLoaded(null),
              style: {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: loaded === picture ? 1 : 0,
              },
            }),
          h(
            "div",
            {
              style: {
                position: "absolute",
                insetInline: "var(--space-4)",
                top: "var(--space-4)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              },
            },
            h(Avatar, { name, src: picture, size: "large" }),
            h("strong", { className: "dark text-heading font-bold text-standard" }, "Marmot ID"),
            h(
              "span",
              { style: { marginInlineStart: "auto", display: "inline-flex" }, title: "End-to-end encryption key" },
              h(LockIcon, { size: "1.25rem" }),
            ),
          ),
        ),
        h(
          "div",
          {
            style: {
              color: "var(--text-standard)",
              padding: "var(--space-4)",
              display: "grid",
              gap: "var(--space-1)",
              background: "var(--surface-inset)",
            },
          },
          h(
            "span",
            {
              className: "text-caption text-subtle",
              style: { paddingBlock: "var(--space-half)", textAlign: "center" },
            },
            "PUBLIC KEY",
          ),
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns:
                  "minmax(var(--space-5), 1fr) minmax(0, max-content) minmax(var(--space-5), 1fr)",
                alignItems: "center",
                gap: "var(--space-1)",
              },
            },
            h("code", { className: "text-mono-lg", style: { gridColumn: 2 } }, npub ? abbreviated(npub) : "…"),
            npub &&
              h(
                "button",
                {
                  type: "button",
                  "aria-label": "Copy Marmot ID",
                  title: copied ? "Copied" : "Copy your full Marmot ID (npub)",
                  onClick: async () => {
                    await copy(npub);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  },
                  style: {
                    gridColumn: 3,
                    justifySelf: "start",
                    display: "inline-grid",
                    placeItems: "center",
                    width: "1.5rem",
                    height: "1.5rem",
                    border: 0,
                    borderRadius: "var(--radius-icon-button, var(--radius-control))",
                    background: "transparent",
                    color: "var(--text-subtle)",
                    cursor: "pointer",
                  },
                },
                copied
                  ? h(Svg, { size: "0.875rem" }, h("path", { d: "M5 12l5 5L20 7" }))
                  : h(
                      Svg,
                      { size: "0.875rem" },
                      h("rect", { x: 9, y: 9, width: 12, height: 12, rx: 2 }),
                      h("path", { d: "M5 15V5a2 2 0 0 1 2-2h10" }),
                    ),
              ),
          ),
        ),
      ),
    );
  }

  function MarmotSettings() {
    const state = useStore();
    const relay = useRelaySession();
    const me = viewer();
    const profiles = useProfiles(relay, me ? [me] : []);
    const profile = me ? profiles.get(me) : undefined;
    return h(
      "div",
      { className: "text-body-sm", style: { display: "grid", gap: "var(--space-2)" } },
      state.account
        ? h(MarmotIdCard, {
            state,
            profile: profile && { ...profile, picture: avatarSrc(relay, profile.picture) },
          })
        : h("p", { style: subtle }, state.phase === "failed" ? errorText(state.error) : state.step || "Starting…"),
      h("p", { style: subtle }, bindingText(state)),
      state.home && h("p", { style: subtle }, `Stored in ${state.home}`),
      h("p", { style: subtle }, `Marmot relays: ${MARMOT_RELAYS.join(", ")}`),
    );
  }

  ctx.settingsCards?.register?.({
    id: "marmot",
    title: "Encrypted chats",
    group: "Plugins",
    component: MarmotSettings,
  });

  // ---- sidebar ------------------------------------------------------------

  /**
   * A row's avatar that also marks its row unread the way DM rows look.
   * Section rows have no unread field and only the icon is ours, so it styles
   * its own host row: semibold name in the unread ink (the selected ink when
   * selected) and the DM's trailing dot.
   */
  function RowIcon({ unread, ...avatar }) {
    const ref = React.useRef(null);
    React.useLayoutEffect(() => {
      const item = ref.current?.closest(".navigation-item");
      const label = item?.querySelector(".navigation-item-label");
      if (!unread || !item || !label) return undefined;
      const dot = document.createElement("span");
      dot.setAttribute("data-marmot-unread", "");
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", "Unread messages");
      Object.assign(dot.style, {
        display: "block",
        flexShrink: "0",
        width: "0.375rem",
        height: "0.375rem",
        marginInlineStart: "auto",
        borderRadius: "50%",
        background: "var(--affordance-prominent-mark)",
      });
      item.append(dot);
      const emphasize = () => {
        label.style.fontWeight = "var(--type-weight-semibold)";
        label.style.color = item.hasAttribute("data-selected") ? "" : "var(--text-navigation-unread)";
      };
      emphasize();
      const watch = new MutationObserver(emphasize);
      watch.observe(item, { attributes: true, attributeFilter: ["data-selected"] });
      return () => {
        watch.disconnect();
        dot.remove();
        label.style.removeProperty("font-weight");
        label.style.removeProperty("color");
      };
    }, [unread]);
    return h("span", { ref, style: { display: "contents" } }, h(Avatar, { ...avatar, size: "compact" }));
  }

  if (sidebarSections) {
    const SECTION_TITLE = "Encrypted messages";
    const MENU_LABEL = `${SECTION_TITLE} options`;
    let closeMenu = null;
    ctx.effect(() => () => closeMenu?.(false));
    const toggleMenu = () => {
      if (closeMenu) return closeMenu(true);
      const anchor = [...document.querySelectorAll("[data-sidebar-section] button")].find(
        (button) => button.getAttribute("aria-label") === MENU_LABEL,
      );
      if (!anchor) throw new Error("The menu button is not on screen");
      const { filter, sort, untagged } = prefs.get();
      const npub = store.get().account?.npub;
      closeMenu = openMenu(
        anchor,
        SECTION_TITLE,
        [
          {
            kind: "choices",
            label: "Filter",
            icon: "filter",
            value: filter,
            choices: [
              { value: "all", label: "All", icon: "all" },
              { value: "unreads", label: "Unreads", icon: "unreads" },
            ],
            change: (value) => setPref({ filter: value }),
          },
          {
            kind: "choices",
            label: "Sort",
            icon: "sort",
            value: sort,
            choices: [
              { value: "recent", label: "Recent", icon: "recent" },
              { value: "alpha", label: "A–Z", icon: "alpha" },
            ],
            change: (value) => setPref({ sort: value }),
          },
          {
            kind: "check",
            label: "Show untagged chats",
            icon: "tag",
            checked: untagged,
            change: (checked) => setPref({ untagged: checked }),
          },
          { kind: "separator" },
          {
            kind: "item",
            label: "Copy my Marmot ID",
            icon: "copy",
            disabled: !npub,
            run: () => void copy(npub).catch(() => {}),
          },
        ],
        () => {
          closeMenu = null;
        },
      );
    };

    let lastKey = [];
    let rows = [];
    const profilesStore = () => relaySession()?.profiles;
    const profilesNow = () => profilesStore()?.snapshot?.() ?? emptyProfiles;
    const requested = new Set();
    const snapshot = () => {
      const state = store.get();
      const profiles = profilesNow();
      const relay = relaySession();
      const ready = state.phase === "ready";
      const { filter, sort, untagged } = prefs.get();
      const community = activeCommunity();
      const key = [state.chats, state.invites, state.members, state.directory, profiles, ready, relay, filter, sort, untagged, community];
      if (key.every((value, index) => value === lastKey[index])) return rows;
      lastKey = key;
      const wanted = [];
      const row = (chat, extra) => {
        const others = (state.members[chat.id] ?? []).map((member) => buzzOf(state, member));
        for (const pubkey of others)
          if (HEX_KEY.test(pubkey) && !profiles.has(pubkey) && !requested.has(pubkey))
            wanted.push(pubkey);
        const first = others.find((pubkey) => HEX_KEY.test(pubkey));
        const title = chatTitle(state, chat, profiles);
        return {
          id: chat.id,
          label: title,
          icon: h(RowIcon, {
            name: title,
            src: first ? avatarSrc(relay, profiles.get(first)?.picture) : undefined,
            unread: chat.unread > 0,
          }),
          ...extra,
        };
      };
      const visible = (chat) => inView(chat, community, untagged);
      const invites = state.invites.filter(visible);
      const invited = new Set(state.invites.map((invite) => invite.id));
      const chats = state.chats.filter((chat) => !chat.pending && !invited.has(chat.id) && visible(chat));
      const ordered = (list) =>
        sort === "alpha"
          ? list.sort((a, b) => a.label.localeCompare(b.label))
          : list.sort((a, b) => (b.at || 0) - (a.at || 0));
      rows = [
        ...ordered(invites.map((chat) => ({ ...row(chat, { status: "Invite" }), at: chat.at }))),
        ...ordered(
          chats
            .filter((chat) => filter === "all" || chat.unread > 0)
            .map((chat) => ({ ...row(chat), at: chat.at })),
        ),
      ].map(({ at, ...shown }) => shown);
      if (!invites.length && !chats.length)
        rows = [{ id: "new", label: ready ? "Start an encrypted chat" : "Encrypted chats" }];
      if (wanted.length) {
        for (const pubkey of wanted) requested.add(pubkey);
        // Outside the snapshot read: a profile fetch notifies its listeners.
        setTimeout(() => void profilesStore()?.ensure?.(wanted)?.catch?.(() => {}));
      }
      return rows;
    };
    const subscribe = (listener) => {
      const stops = [store.subscribe(listener), prefs.subscribe(listener), ctx.relay.subscribe(listener)];
      let profiles = null;
      let stopProfiles = null;
      const follow = () => {
        const next = profilesStore();
        if (next === profiles) return;
        stopProfiles?.();
        profiles = next;
        stopProfiles = next?.subscribe?.(listener) ?? null;
      };
      follow();
      stops.push(ctx.relay.subscribe(follow));
      return () => {
        for (const stop of stops) stop();
        stopProfiles?.();
      };
    };
    sidebarSections.register({
      version: 1,
      id: "encrypted",
      title: SECTION_TITLE,
      // Required, and rendered as given before the title: `false` renders
      // nothing, so the title sits flush like "Direct messages".
      icon: false,
      rows: { snapshot, subscribe },
      select: (row) => pageTarget(row.id === "new" ? NEW_CHAT : { chat: row.id }),
      actions: [
        {
          id: "more",
          label: MENU_LABEL,
          icon: h(DotsIcon),
          onSelect: toggleMenu,
        },
        {
          id: "new-chat",
          label: "New encrypted chat",
          icon: h(PlusIcon),
          onSelect: async () => {
            await ctx.navigation.open(pageTarget(NEW_CHAT));
          },
        },
      ],
    });
  }
}
