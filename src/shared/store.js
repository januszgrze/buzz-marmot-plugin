// A tiny external store for React's useSyncExternalStore.

export function createStore(initial) {
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
