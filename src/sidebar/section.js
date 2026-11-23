// The Encrypted messages sidebar section: rows, filters, "…" and + actions.
import { HEX_KEY, NEW_CHAT } from "../shared/constants.js";
import { openMenu } from "./menu.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createSection(env) {
  const { ctx, h, sidebarSections, store, relaySession, activeCommunity, inView, prefs, setPref, pageTarget, emptyProfiles, copy, buzzOf, chatTitle, avatarSrc, PlusIcon, DotsIcon, Invite, RowIcon } = env;

  if (sidebarSections) {
    const SECTION_TITLE = "Encrypted messages";
    const MENU_LABEL = `${SECTION_TITLE} options`;
    let closeMenu = null;
    ctx.effect(() => () => closeMenu?.(false));
    const toggleMenu = () => {
      if (closeMenu) return closeMenu(true);
      const anchor = [...document.querySelectorAll("[data-sidebar-section] button")].find(
        (button) => button.getAttribute("aria-label") === MENU_LABEL,
      );
      if (!anchor) throw new Error("The menu button is not on screen");
      const { filter, sort, untagged } = prefs.get();
      const npub = store.get().account?.npub;
      closeMenu = openMenu(
        anchor,
        SECTION_TITLE,
        [
          {
            kind: "choices",
            label: "Filter",
            icon: "filter",
            value: filter,
            choices: [
              { value: "all", label: "All", icon: "all" },
              { value: "unreads", label: "Unreads", icon: "unreads" },
            ],
            change: (value) => setPref({ filter: value }),
          },
          {
            kind: "choices",
            label: "Sort",
            icon: "sort",
            value: sort,
            choices: [
              { value: "recent", label: "Recent", icon: "recent" },
              { value: "alpha", label: "A–Z", icon: "alpha" },
            ],
            change: (value) => setPref({ sort: value }),
          },
          {
            kind: "check",
            label: "Show untagged chats",
            icon: "tag",
            checked: untagged,
            change: (checked) => setPref({ untagged: checked }),
          },
          { kind: "separator" },
          {
            kind: "item",
            label: "Copy my Marmot ID",
            icon: "copy",
            disabled: !npub,
            run: () => void copy(npub).catch(() => {}),
          },
        ],
        () => {
          closeMenu = null;
        },
      );
    };

    let lastKey = [];
    let rows = [];
    const profilesStore = () => relaySession()?.profiles;
    const profilesNow = () => profilesStore()?.snapshot?.() ?? emptyProfiles;
    const requested = new Set();
    const snapshot = () => {
      const state = store.get();
      const profiles = profilesNow();
      const relay = relaySession();
      const ready = state.phase === "ready";
      const { filter, sort, untagged } = prefs.get();
      const community = activeCommunity();
      const key = [state.chats, state.invites, state.members, state.directory, profiles, ready, relay, filter, sort, untagged, community];
      if (key.every((value, index) => value === lastKey[index])) return rows;
      lastKey = key;
      const wanted = [];
      const row = (chat, extra) => {
        const others = (state.members[chat.id] ?? []).map((member) => buzzOf(state, member));
        for (const pubkey of others)
          if (HEX_KEY.test(pubkey) && !profiles.has(pubkey) && !requested.has(pubkey))
            wanted.push(pubkey);
        const first = others.find((pubkey) => HEX_KEY.test(pubkey));
        const title = chatTitle(state, chat, profiles);
        return {
          id: chat.id,
          label: title,
          icon: h(RowIcon, {
            name: title,
            src: first ? avatarSrc(relay, profiles.get(first)?.picture) : undefined,
            unread: chat.unread > 0,
          }),
          ...extra,
        };
      };
      const visible = (chat) => inView(chat, community, untagged);
      const invites = state.invites.filter(visible);
      const invited = new Set(state.invites.map((invite) => invite.id));
      const chats = state.chats.filter((chat) => !chat.pending && !invited.has(chat.id) && visible(chat));
      const ordered = (list) =>
        sort === "alpha"
          ? list.sort((a, b) => a.label.localeCompare(b.label))
          : list.sort((a, b) => (b.at || 0) - (a.at || 0));
      rows = [
        ...ordered(invites.map((chat) => ({ ...row(chat, { status: "Invite" }), at: chat.at }))),
        ...ordered(
          chats
            .filter((chat) => filter === "all" || chat.unread > 0)
            .map((chat) => ({ ...row(chat), at: chat.at })),
        ),
      ].map(({ at, ...shown }) => shown);
      if (!invites.length && !chats.length)
        rows = [{ id: "new", label: ready ? "Start an encrypted chat" : "Encrypted chats" }];
      if (wanted.length) {
        for (const pubkey of wanted) requested.add(pubkey);
        // Outside the snapshot read: a profile fetch notifies its listeners.
        setTimeout(() => void profilesStore()?.ensure?.(wanted)?.catch?.(() => {}));
      }
      return rows;
    };
    const subscribe = (listener) => {
      const stops = [store.subscribe(listener), prefs.subscribe(listener), ctx.relay.subscribe(listener)];
      let profiles = null;
      let stopProfiles = null;
      const follow = () => {
        const next = profilesStore();
        if (next === profiles) return;
        stopProfiles?.();
        profiles = next;
        stopProfiles = next?.subscribe?.(listener) ?? null;
      };
      follow();
      stops.push(ctx.relay.subscribe(follow));
      return () => {
        for (const stop of stops) stop();
        stopProfiles?.();
      };
    };
    sidebarSections.register({
      version: 1,
      id: "encrypted",
      title: SECTION_TITLE,
      // Required, and rendered as given before the title: `false` renders
      // nothing, so the title sits flush like "Direct messages".
      icon: false,
      rows: { snapshot, subscribe },
      select: (row) => pageTarget(row.id === "new" ? NEW_CHAT : { chat: row.id }),
      actions: [
        {
          id: "more",
          label: MENU_LABEL,
          icon: h(DotsIcon),
          onSelect: toggleMenu,
        },
        {
          id: "new-chat",
          label: "New encrypted chat",
          icon: h(PlusIcon),
          onSelect: async () => {
            await ctx.navigation.open(pageTarget(NEW_CHAT));
          },
        },
      ],
    });
  }
  return {  };
}
