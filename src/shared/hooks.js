// React hooks over the plugin store and Buzz's relay session, plus navigation targets.
import { HEX_KEY, PAGE_ID, PLUGIN_ID } from "./constants.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createHooks(env) {
  const { ctx, React, store, relaySession } = env;

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
  return { useStore, useRelaySession, pageTarget, emptyProfiles, noProfiles, noSubscribe, useProfiles, copy };
}
