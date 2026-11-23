// Presentation helpers in Buzz's markup and tokens: icons, avatars, buttons, styles.
import { errorText } from "../marmot/envelope.js";
import { MARMOT_RELAYS } from "./constants.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createUi(env) {
  const { React, h, ui, kit, syncIdentity, copy } = env;

  // ---- presentation: Buzz markup and tokens ---------------------------------

  function Svg({ size = "1em", strokeWidth = 2, children, style }) {
    return h(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
        style: { flex: "none", ...style },
      },
      children,
    );
  }
  const LockIcon = ({ size, style }) =>
    h(
      Svg,
      { size, style },
      h("rect", { x: 4, y: 11, width: 16, height: 10, rx: 2 }),
      h("path", { d: "M8 11V7a4 4 0 0 1 8 0v4" }),
    );
  // The sidebar header's "+" and "…": Buzz's Tabler glyphs at its 15px / 2.5.
  const PlusIcon = () =>
    h(Svg, { size: 15, strokeWidth: 2.5 }, h("path", { d: "M12 5l0 14M5 12l14 0" }));
  const DotsIcon = () =>
    h(
      Svg,
      { size: 15, strokeWidth: 2.5 },
      h("path", { d: "M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" }),
    );
  const ChatIcon = () =>
    h(
      Svg,
      { size: "1.5rem" },
      h("path", {
        d: "M4 19.5 5.3 15A8 8 0 1 1 9 18.7z",
      }),
    );

  /** Buzz's Avatar markup (`.buzz-avatar`), so host styles size and tint it. */
  function Avatar({ name, src, size = "default" }) {
    const [loaded, setLoaded] = React.useState(null);
    const initial = Array.from((name ?? "").trim())[0]?.toUpperCase() || "?";
    return h(
      "span",
      { className: "buzz-avatar-status", "data-size": size, "data-shape": "circle" },
      h(
        "span",
        {
          "data-buzz-ui": "",
          className: "buzz-avatar",
          "data-size": size,
          "data-avatar-shape": "circle",
          "data-fallback-surface": "subtle",
          "aria-hidden": true,
        },
        src &&
          h("img", {
            key: src,
            src,
            alt: "",
            "data-loaded": loaded === src ? "true" : undefined,
            onLoad: () => setLoaded(src),
            onError: () => setLoaded(null),
          }),
        (!src || loaded !== src) &&
          h("span", { "aria-hidden": true, "data-avatar-fallback": "" }, initial),
      ),
    );
  }

  /** Buzz's small AvatarStack, as a conversation header shows its members. */
  function AvatarStack({ people }) {
    return h(
      "span",
      {
        className: "text-caption",
        "aria-hidden": true,
        style: {
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          whiteSpace: "nowrap",
          isolation: "isolate",
          paddingInlineEnd: "var(--space-1)",
        },
      },
      people.slice(0, 3).map((person, index) =>
        h(
          "span",
          {
            key: person.id,
            title: person.name,
            style: {
              position: "relative",
              zIndex: index + 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              width: "1.5rem",
              height: "1.5rem",
              padding: "1.5px",
              marginInlineEnd: "calc(-1 * var(--space-1))",
              overflow: "hidden",
              borderRadius: "var(--radius-pill)",
              background: "var(--surface-panel)",
            },
          },
          h(Avatar, { name: person.name, src: person.src, size: "fill" }),
        ),
      ),
    );
  }

  /** Buzz's EmptyState markup (`.buzz-empty-state`). */
  function EmptyState({ title, description }) {
    return h(
      "div",
      { "data-buzz-ui": "", className: "buzz-empty-state" },
      h(
        "div",
        { className: "buzz-empty-state-content" },
        h("span", { className: "buzz-empty-state-icon", "aria-hidden": true }, h(ChatIcon)),
        h(
          "div",
          { className: "buzz-empty-state-copy" },
          h("h3", { className: "buzz-empty-state-title" }, title),
          description &&
            h("p", { className: "buzz-empty-state-description" }, description),
        ),
      ),
    );
  }

  function Button({ variant = "subtle", loading, ...props }) {
    const Host = kit()?.Button;
    if (Host) return h(Host, { variant, size: "sm", loading, ...props });
    return h("button", { type: "button", ...props });
  }

  const subtle = { color: "var(--text-subtle)" };
  const danger = { color: "var(--text-danger)" };
  const warning = { color: "var(--text-warning)" };
  // NewMessage.module.css `.page`, `.blank` and `.feedback`.
  const pageStyle = {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
  };
  const feedbackStyle = { ...subtle, paddingInline: "var(--space-6)" };
  // Channels.module.css `.root`: the frame every Buzz conversation sits in.
  const rootStyle = {
    height: "100%",
    minHeight: 0,
    containerType: "inline-size",
    color: "var(--text-standard)",
    fontSize: "var(--text-body-sm)",
    lineHeight: "var(--text-body-sm--line-height)",
    letterSpacing: "var(--text-body-sm--letter-spacing)",
  };
  const columnStyle = {
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  function Status({ state }) {
    if (state.phase === "failed")
      return h(
        "div",
        {
          className: "text-body-sm",
          style: {
            padding: "var(--space-6)",
            display: "grid",
            gap: "var(--space-2)",
            maxWidth: "40rem",
          },
        },
        h("h2", null, "Encrypted chats are not available"),
        h("p", { style: danger }, errorText(state.error)),
        h(
          "p",
          { style: subtle },
          "Check that `wn` and `wnd` are on Buzz's search path (~/.local/bin, Homebrew, or your login shell PATH) and that a Marmot relay is reachable: ",
          MARMOT_RELAYS.join(", "),
          ".",
        ),
        state.home && h("p", { style: subtle }, `Home: ${state.home}`),
        h(
          "div",
          null,
          h(
            Button,
            {
              variant: "prominent",
              onClick: () => {
                sessionHome = null;
                syncIdentity();
              },
            },
            "Try again",
          ),
        ),
      );
    return h(
      "p",
      {
        role: "status",
        className: "text-body-sm",
        style: { ...subtle, padding: "var(--space-8) var(--space-4)" },
      },
      state.step || "Loading…",
    );
  }
  return { Svg, LockIcon, PlusIcon, DotsIcon, ChatIcon, Avatar, AvatarStack, EmptyState, Button, subtle, danger, warning, pageStyle, feedbackStyle, rootStyle, columnStyle, Status };
}
