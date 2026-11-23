// The Settings → Plugins card.
import { errorText } from "../marmot/envelope.js";
import { MARMOT_RELAYS } from "../shared/constants.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createSettings(env) {
  const { ctx, h, viewer, useStore, useRelaySession, useProfiles, avatarSrc, subtle, bindingText, MarmotIdCard } = env;

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
  return { MarmotSettings };
}
