// Harness settings (see dev/harness.mjs for the environment variables), the
// fake Buzz identities and communities, and small shared helpers.
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const home = homedir();
export const BUZZ_APP = process.env.BUZZ_APP ?? fileURLToPath(new URL("../../../buzz-app", import.meta.url));
export const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "~/.buzz-marmot-dev/harness";
export const PEER_HOME = process.env.PEER_HOME ?? `${home}/.buzz-marmot-dev/harness-peer`;
export const VIEWER = process.env.VIEWER ?? "ab".repeat(32);
export const PEER_BUZZ = "cd".repeat(32);
export const UNBOUND_BUZZ = "ef".repeat(32);
// A third person: a fresh headless wn account per run (so no chat with them
// exists yet), whose Buzz identity publishes its binding mid-run.
export const CAROL_BUZZ = "c4".repeat(32);
export const CAROL_HOME = `${home}/.buzz-marmot-dev/harness-carol-${Date.now()}`;
export const BINDING_D = "marmot.chats:binding";
export const LOCAL_RELAY = "ws://127.0.0.1:27777";
// Community origins as stock Buzz's `ctx.relay.selected()` spells them, and
// the tags the plugin writes for them.
export const COMMUNITY_A = "https://community-a.test";
export const COMMUNITY_B = "http://localhost:3999";
export const TAG_A = "buzz-community/v1 wss://community-a.test";
export const bootOnly = process.argv.includes("--boot-only");
export const expand = (p) => (p.startsWith("~/") ? `${home}${p.slice(1)}` : p);

/** Loads packages (React, jsdom, nostr-tools) from the buzz-app checkout. */
export const require = createRequire(`${BUZZ_APP}/package.json`);

export const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
