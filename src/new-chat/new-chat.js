// Buzz's New message view, whose first message creates or continues a chat.
import { shortKey } from "../shared/format.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createNewChat(env) {
  const { ctx, React, h, ui, store, activeCommunity, lookupBindings, noMarmotId, existingChat, pageTarget, useProfiles, personName, subtle, danger, pageStyle, feedbackStyle, Status, ToField } = env;

  /** Buzz's New message view, whose first message creates the encrypted group. */
  function NewChat({ state, relay }) {
    const [recipients, setRecipients] = React.useState([]);
    const [typed, setTyped] = React.useState(false);
    const [busy, setBusy] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [focus, setFocus] = React.useState(0);
    const profiles = useProfiles(relay, recipients.map((person) => person.pubkey));
    const recipientNames = recipients
      .map((person) => (person.marmot ? person.name : personName(profiles, person.pubkey) || person.name))
      .join(", ");
    const ready = state.phase === "ready" && !!relay;
    const marmotOf = React.useMemo(
      () => new Map(Object.entries(state.directory).map(([marmot, buzz]) => [buzz, marmot])),
      [state.directory],
    );
    const accounts = recipients.map((person) => (person.marmot ? person.pubkey : marmotOf.get(person.pubkey)));
    const continuing =
      recipients.length && accounts.every(Boolean) ? existingChat(accounts, activeCommunity()) : null;
    // An error names the people it was about; new recipients clear it.
    React.useEffect(() => setError(null), [recipients]);
    const send = async (draft) => {
      const content = (draft?.text ?? "").trim();
      if (!content) return;
      setError(null);
      setBusy("Looking up Marmot IDs…");
      try {
        const community = activeCommunity();
        if (!community) throw new Error("Buzz is not connected to a community yet.");
        const raw = recipients.filter((person) => person.marmot);
        const people = recipients.filter((person) => !person.marmot);
        const found = people.length
          ? await lookupBindings(people.map((person) => person.pubkey))
          : { npubs: [], accounts: [], missing: [] };
        if (found.error) throw new Error(found.error);
        if (found.missing.length) {
          const who = people
            .filter((person) => found.missing.includes(person.pubkey))
            .map((person) => person.name || shortKey(person.pubkey))
            .join(", ");
          throw new Error(noMarmotId(who));
        }
        const existing = existingChat(
          [...found.accounts, ...raw.map((person) => person.pubkey)],
          community,
        );
        if (existing) {
          setBusy("Sending message…");
          const problem = await env.session?.send(existing.id, content);
          if (problem !== null) throw new Error(problem ?? "Marmot is not ready yet.");
          await ctx.navigation.open(pageTarget({ chat: existing.id }));
          return;
        }
        setBusy("Creating the encrypted chat and sending invites…");
        const created = await env.session?.createChat(
          recipientNames.slice(0, 80) || "Encrypted chat",
          [...found.npubs, ...raw.map((person) => person.marmot)],
          community,
        );
        if (!created) throw new Error("Marmot is not ready yet.");
        if (created.error) throw new Error(created.error);
        setBusy("Sending message…");
        const problem = await env.session.send(created.groupId, content);
        if (problem) throw new Error(problem);
        if (created.warning) store.set({ notice: created.warning });
        await ctx.navigation.open(pageTarget({ chat: created.groupId }));
      } catch (failed) {
        setError(String(failed?.message ?? failed));
      } finally {
        setBusy(null);
      }
    };
    if (!ready) return h(Status, { state });
    return h(
      "section",
      { style: pageStyle, "aria-label": "New encrypted chat" },
      h(ToField, {
        relay,
        state,
        selected: recipients,
        onChange: setRecipients,
        disabled: !!busy,
        onTyped: setTyped,
        onComplete: () => setFocus((n) => n + 1),
      }),
      h("div", {
        style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
      }),
      (busy || error || continuing) &&
        h(
          "div",
          { className: "text-body-sm", style: feedbackStyle },
          continuing &&
            !busy &&
            !error &&
            h(
              "p",
              { "data-testid": "marmot-continuing", style: { ...subtle, marginBlock: "var(--space-2)" } },
              "You already have an encrypted chat with them in this community. Your message continues it.",
            ),
          busy && h("p", { role: "status", style: { marginBlock: "var(--space-2)" } }, busy),
          error &&
            h("p", { role: "alert", style: { ...danger, marginBlock: "var(--space-2)" } }, error),
        ),
      ui.Composer &&
        h(ui.Composer, {
          session: relay,
          scope: relay.scope,
          channelId: "marmot:new",
          channelName: recipientNames || "new message",
          label: recipientNames ? `Message ${recipientNames}` : "New message",
          placeholder: recipientNames ? undefined : "",
          focusRequest: focus,
          disabled: !recipients.length,
          submission: {
            draftKey: "marmot.chats:new",
            locked: !!busy,
            disabled: !ready || !!busy || !recipients.length || typed,
            submit: (draft) => void send(draft),
          },
        }),
    );
  }
  return { NewChat };
}
