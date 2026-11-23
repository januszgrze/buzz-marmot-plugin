// The relay session and viewer from ctx.relay.
/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createHost(env) {
  const { ctx } = env;

  const relaySession = () => {
    const snapshot = ctx.relay.snapshot();
    return snapshot.status === "ready" || snapshot.cached
      ? snapshot.session
      : undefined;
  };
  const viewer = () => ctx.relay.snapshot().viewer;
  return { relaySession, viewer };
}
