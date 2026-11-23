// One encrypted conversation in Buzz's tab workspace.
/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createConversation(env) {
  const { ctx, React, h, conversation, ui, viewer, useProfiles, buzzOf, personName, chatTitle, avatarSrc, LockIcon, EmptyState, danger, warning, feedbackStyle, rootStyle, columnStyle, Invite, Timeline, Identity, InfoButton } = env;

  /** One encrypted conversation in Buzz's tab workspace, rows and composer. */
  function Conversation({ state, chat, relay }) {
    const messages = state.messages[chat.id];
    const me = viewer();
    const rows = React.useMemo(
      () =>
        (messages ?? []).map((message) => ({
          id: message.id,
          channelId: `marmot:${chat.id}`,
          authorId: message.own ? me : buzzOf(state, message.from),
          createdAt: message.at,
          content: message.text,
          mentions: [],
          attachments: [],
          reactions: [],
          replyCount: 0,
          participants: [],
        })),
      [messages, chat.id, me, state.directory],
    );
    const memberKeys = (state.members[chat.id] ?? []).map((member) => buzzOf(state, member));
    const profiles = useProfiles(relay, [
      ...new Set([...rows.map((row) => row.authorId), ...memberKeys, ...(me ? [me] : [])]),
    ]);
    const title = chatTitle(state, chat, profiles);
    const people = [...memberKeys, ...(me ? [me] : [])].map((pubkey) => ({
      id: pubkey,
      name: personName(profiles, pubkey),
      src: avatarSrc(relay, profiles.get(pubkey)?.picture),
    }));
    people.sort((a, b) => Number(!!b.src) - Number(!!a.src));
    const invited = chat.pending || state.invites.some((invite) => invite.id === chat.id);
    const lastOwn = [...(messages ?? [])].reverse().find((m) => m.own)?.id;
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);
    const send = async (draft) => {
      const content = (draft?.text ?? "").trim();
      if (!content || !env.session) return;
      setBusy(true);
      setError(null);
      const problem = await env.session.send(chat.id, content);
      setBusy(false);
      if (problem) setError(problem);
    };
    const body = h(
      "div",
      { style: columnStyle },
      h(
        "div",
        { style: { display: "flex", flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0 } },
        h(Timeline, {
          rows,
          profiles,
          relay,
          me,
          loading: messages === undefined,
          empty: h(EmptyState, {
            title: "No messages yet.",
            description: invited
              ? "Accept the invite to read and send messages."
              : "Start the conversation below.",
          }),
        }),
        state.notice &&
          h("p", { className: "text-body-sm", style: { ...feedbackStyle, ...warning } }, state.notice),
        error &&
          h("p", { role: "alert", className: "text-body-sm", style: { ...feedbackStyle, ...danger } }, error),
        invited
          ? h(Invite, { chat })
          : relay &&
              messages !== undefined &&
              h(ui.Composer, {
                session: relay,
                scope: relay.scope,
                channelId: `marmot:${chat.id}`,
                channelName: title,
                label: `Message ${title}`,
                submission: {
                  // A new own message moves the key, which clears the composer.
                  draftKey: `marmot.chats:${chat.id}:${lastOwn ?? "first"}`,
                  locked: busy,
                  disabled: busy,
                  submit: (draft) => void send(draft),
                },
              }),
      ),
    );
    const Workspace = ctx.panels?.ui?.Workspace;
    return h(
      "div",
      { style: rootStyle, "aria-label": `Encrypted chat ${title}`, role: "region" },
      h(
        "div",
        { style: columnStyle },
        Workspace
          ? h(Workspace, {
              main: true,
              label: "Encrypted chat tabs",
              focusOnMount: false,
              value: "conversation",
              select: () => {},
              identity: h(Identity, { title, people }),
              actions: h(InfoButton, { relay }),
              items: [
                {
                  id: "conversation",
                  label: title,
                  icon: h(LockIcon, { size: "1rem" }),
                  content: body,
                },
              ],
            })
          : body,
      ),
    );
  }
  return { Conversation };
}
