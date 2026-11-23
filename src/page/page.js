// The Encrypted chats page and its registration.
import { HEX, PAGE_ID } from "../shared/constants.js";

const lockSvg =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  );

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createPage(env) {
  const { ctx, React, h, sidebarSections, activeCommunity, inView, prefs, useStore, useRelaySession, EmptyState, rootStyle, Status, NewChat, Conversation } = env;

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
      if (routeChat && !hidden) void env.session?.openChat(routeChat);
      else env.session?.closeChat();
    }, [routeChat, navigation?.entryId, state.phase, hidden]);
    // Leaving the page stops reading the chat; returning to the window reads it.
    React.useEffect(() => () => env.session?.closeChat(), []);
    React.useEffect(() => {
      if (!routeChat) return undefined;
      const seen = () => {
        if (env.session?.viewing(routeChat)) void env.session.markRead(routeChat);
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
  return { MarmotPage };
}
