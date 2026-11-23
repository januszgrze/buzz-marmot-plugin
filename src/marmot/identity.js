// One wn session per signed-in Buzz identity, restarted when it changes.
import { homeFor } from "./home.js";
import { INITIAL, createSession } from "./session.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createIdentity(env) {
  const { ctx, store, viewer, resetBinding, ensureBinding, loadDirectory } = env;
  let session = null;
  let sessionHome = null;
  Object.defineProperty(env, "session", { get: () => session, enumerable: true });
  function syncIdentity() {
    const home = homeFor(viewer());
    void ensureBinding();
    // A reconnecting relay can briefly report no viewer; keep the session.
    if (!home || home === sessionHome) return;
    session?.stop();
    sessionHome = home;
    resetBinding();
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
  return { syncIdentity };
}
