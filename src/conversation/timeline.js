// Invites and the message timeline, using Buzz's own message rows.
import { STACK_SECONDS } from "../shared/constants.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createTimeline(env) {
  const { React, h, ui, viewer, Button, subtle, danger } = env;

  // ---- conversation: Buzz's DM / group view ----------------------------------

  /** Invite in place of the composer, sized like the composer it replaces. */
  function Invite({ chat }) {
    const [busy, setBusy] = React.useState(null);
    const [error, setError] = React.useState(null);
    const act = async (kind) => {
      setBusy(kind);
      setError(null);
      const problem = env.session
        ? await (kind === "accept" ? env.session.accept(chat.id) : env.session.decline(chat.id))
        : "Not ready";
      setBusy(null);
      if (problem) setError(problem);
    };
    return h(
      "div",
      {
        className: "text-body-sm",
        style: {
          boxSizing: "border-box",
          width: "min(calc(100% - 2 * var(--space-4)), var(--buzz-message-width, 52rem))",
          margin: "0 auto var(--space-4)",
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--space-2)",
          padding: "var(--space-3)",
          border: "1px solid var(--border-standard)",
          borderRadius: "calc(var(--radius-icon-button) + var(--space-1h) + 1px)",
          background: "var(--surface-composer)",
          boxShadow: "var(--shadow-xs)",
        },
      },
      h("span", { style: { ...subtle, flex: 1 } }, "You were invited to this encrypted chat."),
      h(
        Button,
        {
          variant: "prominent",
          disabled: !!busy,
          loading: busy === "accept",
          onClick: () => act("accept"),
        },
        "Accept",
      ),
      h(Button, { disabled: !!busy, onClick: () => act("decline") }, "Decline"),
      error && h("p", { role: "alert", style: { ...danger, flexBasis: "100%" } }, error),
    );
  }

  const sameDay = (a, b) =>
    new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();
  const stacks = (previous, current) =>
    !!previous &&
    !!current &&
    previous.authorId === current.authorId &&
    current.createdAt >= previous.createdAt &&
    current.createdAt - previous.createdAt <= STACK_SECONDS &&
    sameDay(previous.createdAt, current.createdAt);
  const noLink = () => false;
  const noMedia = () => undefined;

  /** Messages.module.css `.feed`, `.edge`, the centered `ol` and `.timelineEnd`. */
  function Timeline({ rows, profiles, relay, me, loading, empty }) {
    const scroller = React.useRef(null);
    const pinned = React.useRef(true);
    const last = rows.at(-1)?.id;
    React.useLayoutEffect(() => {
      const node = scroller.current;
      if (node && pinned.current) node.scrollTop = node.scrollHeight;
    }, [last, rows.length]);
    return h(
      "section",
      {
        ref: scroller,
        "aria-label": "Channel history",
        tabIndex: -1,
        "data-message-scroller": "",
        onScroll: ({ currentTarget: node }) => {
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8;
        },
        style: {
          "--message-hover-inset": "var(--space-panel-inset)",
          "--timeline-measure": "var(--buzz-message-width, 52rem)",
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowAnchor: "none",
          padding: "0 var(--space-panel-inset)",
          paddingBottom: "var(--space-half)",
          outline: "none",
        },
      },
      h("div", {
        style: {
          width: "min(100%, var(--timeline-measure))",
          marginInline: "auto",
          minHeight: "var(--space-4)",
        },
      }),
      loading &&
        h(
          "p",
          { role: "status", className: "text-body-sm", style: { ...subtle, textAlign: "center" } },
          "Loading messages…",
        ),
      !loading &&
        !rows.length &&
        h("div", { style: { paddingBlock: "var(--space-panel-inset)" } }, empty),
      rows.length > 0 &&
        h(
          "ol",
          {
            style: {
              listStyle: "none",
              padding: 0,
              margin: "0 auto",
              width: "min(100%, var(--timeline-measure))",
            },
          },
          rows.map((row, index) =>
            h(
              "li",
              { key: row.id },
              // No `session` or `scope`: the rows stay read-only, so no reaction,
              // edit, report or read-state write can reach the Buzz relay.
              h(ui.Message, {
                row,
                profile: profiles.get(row.authorId),
                participantProfiles: profiles,
                references: relay,
                viewer: me,
                media: relay?.media ?? noMedia,
                onOpenLink: noLink,
                retry: undefined,
                layout: "timeline",
                day: index === 0 || !sameDay(rows[index - 1].createdAt, row.createdAt),
                stackPrevious: stacks(rows[index - 1], row),
                stackNext: stacks(row, rows[index + 1]),
              }),
            ),
          ),
        ),
      h("div", { "aria-hidden": true, style: { height: "var(--space-8)" } }),
    );
  }
  return { Invite, sameDay, stacks, noLink, noMedia, Timeline };
}
