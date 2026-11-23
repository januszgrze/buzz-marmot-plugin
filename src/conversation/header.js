// The conversation header: member identity and the ⓘ info popover.
import { PLUGIN_REPO_URL } from "../shared/constants.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createHeader(env) {
  const { React, h, ui, Svg, AvatarStack, Button, subtle } = env;

  /** ChannelHeaderIdentity: member avatars, then the name. */
  function Identity({ title, people }) {
    return h(
      "span",
      {
        "data-testid": "marmot-identity",
        style: {
          display: "inline-flex",
          alignItems: "center",
          maxWidth: "100%",
          minWidth: 0,
          gap: "var(--space-2)",
          padding: "0 var(--space-2)",
          color: "var(--text-standard)",
        },
      },
      h(
        "span",
        { "aria-hidden": true, style: { position: "relative", zIndex: 1, display: "flex", alignItems: "center" } },
        h(AvatarStack, { people }),
      ),
      h(
        "span",
        {
          className: "text-body-sm",
          style: {
            display: "flex",
            alignItems: "center",
            minHeight: "var(--size-control-sm)",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        title,
      ),
    );
  }

  const INFO_TITLE = "Encrypted messages (experimental)";
  const INFO_LABEL = "About encrypted messages";
  const InfoIcon = () =>
    h(
      Svg,
      { size: 16 },
      h("path", { d: "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 9h.01M11 12h1v4h1" }),
    );

  /**
   * The header's ⓘ: the host Button as DM header IconButtons render it (ghost,
   * toolbar size; IconButton is not offered to plugins, so its data-icon-*
   * attributes are added here), opening a popover in Buzz's popover markup.
   */
  function InfoButton({ relay }) {
    const [open, setOpen] = React.useState(false);
    const [closing, setClosing] = React.useState(false);
    const [settled, setSettled] = React.useState(false);
    const wrap = React.useRef(null);
    const popup = React.useRef(null);
    const titleId = React.useId();
    const button = () => wrap.current?.querySelector("button");
    const close = React.useCallback((focusButton) => {
      setClosing(true);
      if (focusButton) button()?.focus({ preventScroll: true });
      setTimeout(() => {
        setOpen(false);
        setClosing(false);
        setSettled(false);
      }, 120);
    }, []);
    React.useLayoutEffect(() => {
      const control = button();
      if (!control) return;
      control.setAttribute("data-icon-variant", "ghost");
      control.setAttribute("data-icon-size", "toolbar");
      control.setAttribute("data-icon-shape", "control");
      control.setAttribute("aria-haspopup", "dialog");
      control.setAttribute("aria-expanded", String(open && !closing));
    });
    React.useEffect(() => {
      if (!open || closing) return undefined;
      popup.current?.focus({ preventScroll: true });
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
      const outside = (event) => {
        if (!wrap.current?.contains(event.target)) close(false);
      };
      const keydown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      };
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", keydown, true);
      return () => {
        cancelAnimationFrame(frame);
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", keydown, true);
      };
    }, [open, closing, close]);
    const Markdown = ui.Markdown;
    const contribute = `[Contribute on GitHub](${PLUGIN_REPO_URL})`;
    return h(
      "span",
      { ref: wrap, "data-testid": "marmot-info", style: { position: "relative", display: "inline-flex" } },
      h(Button, {
        variant: "ghost",
        "aria-label": INFO_LABEL,
        title: INFO_LABEL,
        onClick: () => (open ? close(false) : setOpen(true)),
        children: h(InfoIcon),
      }),
      open &&
        h(
          "div",
          {
            ref: popup,
            role: "dialog",
            "aria-labelledby": titleId,
            tabIndex: -1,
            className: "buzz-popover-popup text-body",
            "data-buzz-ui": "",
            "data-size": "default",
            "data-padding": "content",
            "data-side": "bottom",
            ...(closing ? { "data-ending-style": "" } : settled ? {} : { "data-starting-style": "" }),
            style: {
              position: "absolute",
              top: "calc(100% + var(--space-2))",
              right: 0,
              zIndex: "var(--layer-popover)",
              "--transform-origin": "top right",
              "--available-height": "70vh",
              "--available-width": "calc(100vw - var(--space-4))",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              outline: "none",
              textAlign: "start",
            },
          },
          h("h2", { id: titleId, className: "buzz-popover-title text-label", style: { margin: 0 } }, INFO_TITLE),
          ...[
            "These chats are end-to-end encrypted with Marmot (MLS over Nostr), using MDK. Messages travel through Marmot relays, not the Buzz relay.",
            "It’s experimental: expect rough edges, and don’t rely on it for anything critical yet.",
            "Please don’t use Forward on encrypted messages. It sends them again as plain text.",
          ].map((text) =>
            h("p", { key: text, className: "buzz-popover-description text-body-sm", style: { margin: 0, ...subtle } }, text),
          ),
          h(
            "div",
            { className: "text-body-sm", "data-testid": "marmot-contribute" },
            Markdown
              ? h(Markdown, { content: contribute, session: relay ?? undefined })
              : h("a", { href: PLUGIN_REPO_URL, target: "_blank", rel: "noreferrer" }, "Contribute on GitHub"),
          ),
        ),
    );
  }
  return { Identity, INFO_TITLE, INFO_LABEL, InfoIcon, InfoButton };
}
