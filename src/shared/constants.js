// Plugin-wide settings and constants: Marmot relays, repo URL, homes, kinds.

export const PLUGIN_ID = "marmot.chats";
export const PAGE_ID = "chats";
// Marmot relays: the daemon's discovery relays and new accounts' default
// relays (which new groups use). Homes are kept per relay set, so changing
// this starts fresh accounts and leaves the old homes untouched.
export const MARMOT_RELAYS = Object.freeze(["wss://relay.us.whitenoise.chat"]);
// Where people can contribute; linked from the conversation's info popover.
export const PLUGIN_REPO_URL = "https://github.com/januszgrze/buzz-marmot-plugin";
export const HOME_ROOT = "~/.buzz-marmot";
export const RELAY_SET = MARMOT_RELAYS.map((url) =>
  url.replace(/^wss?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "_"),
).join("+");
// Account keys live in the macOS login keychain, one service per home
// (`buzz-marmot.<home id>`), so two Buzz identities never share an entry.
export const KEYCHAIN_SERVICE_PREFIX = "buzz-marmot.";
export const ENV = Object.freeze({
  WN_SECRET_STORE: "keychain",
  WN_HOME: null,
  WN_SOCKET: null,
  WN_ACCOUNT: null,
});
export const MAX_PARALLEL = 4;
export const COMMAND_TIMEOUT_MS = 120_000;
// A freshly started daemon has no relay connection yet; an identity created
// before it connects lacks its relay lists (and so cannot be invited).
export const RELAY_SETTLE_MS = 3_000;
export const CREATE_ATTEMPTS = 3;
export const POLL_MS = 20_000;
export const STREAM_RESTART_MS = 5_000;
export const HISTORY_LIMIT = "200";
export const CHAT_KIND = 9;
// NIP-38 user status is the one addressable kind Buzz signs for any `d` today;
// Buzz reads only `d=general` statuses. Kind 30078 is the intended home once
// Buzz's signer accepts plugin app data.
export const BINDING_KIND = 30315;
export const BINDING_D = "marmot.chats:binding";
export const DIRECTORY_LIMIT = 500;
// A chat's Buzz community rides in its MLS group description (encrypted group
// data, so invitees see it and Marmot relays do not), as one line:
// `buzz-community/v1 wss://host[:port]`. Other versions read as untagged.
export const COMMUNITY_TAG = "buzz-community/v1";
export const COMMUNITY_LINE = /^buzz-community\/v1 (wss?:\/\/\S+)$/m;
export const STACK_SECONDS = 5 * 60;
export const HEX = /^[0-9a-f]+$/;
export const HEX_KEY = /^[0-9a-f]{64}$/;
// Buzz's people search (`directMessages.people`) rejects longer queries and
// pages below 1 with "Invalid people search."
export const PEOPLE_SEARCH_MAX_LENGTH = 100;
export const NPUB = /^npub1[02-9ac-hj-np-z]{58}$/;
export const NEW_CHAT = Object.freeze({ new: true });
