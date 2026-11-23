// Sidebar preferences remembered on this device.
import { createStore } from "./store.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createPrefs(env) {

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
  return { PREFS_KEY, readPrefs, prefs, setPref };
}
