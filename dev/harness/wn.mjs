// Real `wn` processes: the host's `spawn` for the plugin, and CLI accounts
// (the peer and Carol) on the other side of its chats.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { CAROL_HOME, LOCAL_RELAY, PEER_HOME, expand } from "./config.mjs";

/** Every wn command line the plugin ran, for the end-of-run summary. */
export const commands = [];

export const host = {
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
export const peer = wnIn(PEER_HOME, "peer");
export const carol = wnIn(CAROL_HOME, "carol");

/** Starts the peer's daemon and account if needed; returns its account. */
export function ensurePeer() {
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
