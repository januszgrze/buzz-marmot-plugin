// Marmot chats: end-to-end encrypted MLS group chats for Buzz, run through
// MDK's `wn` CLI. `wn daemon start` launches `wnd` in its own process group,
// so the daemon outlives the plugin; every other call is a short `wn --json`
// process. Each Buzz identity gets its own wn home, daemon, socket and account.
//
// It needs only stock Buzz 1.0 plugin services. Conversations use Buzz's own
// message rows, composer and tab workspace; the New chat view, header
// identity and Marmot ID card copy Buzz's DM markup with its global classes
// and tokens where stock offers no component. Each identity publishes its
// Marmot key as an addressable kind 30315 event (d = `marmot.chats:binding`),
// signed by its Buzz key, so others can invite it by picking the Buzz person.
import { INITIAL } from "./marmot/session.js";
import { createBinding } from "./binding/directory.js";
import { createCard } from "./settings/card.js";
import { createCommunity } from "./community/active.js";
import { createConversation } from "./conversation/conversation.js";
import { createHeader } from "./conversation/header.js";
import { createHooks } from "./shared/hooks.js";
import { createHost } from "./shared/host.js";
import { createIdentity } from "./marmot/identity.js";
import { createNames } from "./people/names.js";
import { createNewChat } from "./new-chat/new-chat.js";
import { createPage } from "./page/page.js";
import { createPrefs } from "./shared/prefs.js";
import { createResolve } from "./people/resolve.js";
import { createRowIcon } from "./sidebar/row-icon.js";
import { createSection } from "./sidebar/section.js";
import { createSettings } from "./settings/settings.js";
import { createStore } from "./shared/store.js";
import { createTimeline } from "./conversation/timeline.js";
import { createToField } from "./new-chat/to-field.js";
import { createUi } from "./shared/ui.js";

export const inject = [
  "react",
  "pages",
  "host",
  "relay",
  "navigation",
  "conversation",
  "settingsCards",
  "panels",
];

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const conversation = ctx.conversation;
  const ui = conversation?.ui ?? {};
  const kit = () => ctx.reflect.get("ui");
  const sidebarSections = ctx.reflect.get("sidebarSections");
  const store = createStore(INITIAL);
  // Features share one env: each create* adds its exports for those after it.
  const env = { ctx, React, h, conversation, ui, kit, sidebarSections, store };
  for (const create of [
    createHost,
    createCommunity,
    createPrefs,
    createBinding,
    createResolve,
    createIdentity,
    createHooks,
    createNames,
    createUi,
    createToField,
    createNewChat,
    createTimeline,
    createHeader,
    createConversation,
    createPage,
    createCard,
    createSettings,
    createRowIcon,
    createSection,
  ])
    Object.assign(env, create(env));
}
