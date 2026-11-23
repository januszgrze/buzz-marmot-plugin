// The Marmot ID card, styled like Buzz's ID card.
/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createCard(env) {
  const { React, h, copy, Svg, LockIcon, Avatar, subtle } = env;

  // ---- Settings: the Marmot ID card ----------------------------------------

  function bindingText(state) {
    if (state.binding === "published")
      return "Linked to your Buzz ID: people in this community can start encrypted chats with you.";
    if (state.binding === "unsupported")
      return "This Buzz build cannot publish your Marmot ID, so others cannot invite you by name yet.";
    if (state.binding === "failed")
      return `Could not publish your Marmot ID: ${state.bindingError}`;
    return "Not linked to your Buzz ID yet.";
  }

  const abbreviated = (npub) => `${npub.slice(0, 12)}…${npub.slice(-6)}`;

  /** Buzz's Identity card front (IdentityBadge), for the Marmot key. */
  function MarmotIdCard({ state, profile }) {
    const [copied, setCopied] = React.useState(false);
    const name = profile?.name || "Marmot";
    const picture = profile?.picture;
    const [loaded, setLoaded] = React.useState(null);
    const npub = state.account?.npub;
    return h(
      "div",
      {
        "data-testid": "marmot-id-card",
        style: {
          display: "grid",
          justifyItems: "center",
          gap: "var(--space-3)",
          width: "100%",
          textAlign: "center",
          padding: "var(--space-4)",
          boxSizing: "border-box",
        },
      },
      h(
        "div",
        {
          style: {
            position: "relative",
            overflow: "hidden",
            width: "min(100%, 20rem)",
            border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-card)",
            background: "var(--surface-inset)",
            color: "var(--text-primary)",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
          },
        },
        h(
          "div",
          { style: { position: "relative", width: "100%", aspectRatio: "1", overflow: "hidden" } },
          (!picture || loaded !== picture) &&
            h(
              "span",
              {
                "aria-hidden": true,
                style: {
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: "6rem",
                  fontWeight: 700,
                  color: "var(--text-subtle)",
                  background: "var(--affordance-subtle)",
                },
              },
              name.trim().slice(0, 1).toUpperCase() || "?",
            ),
          picture &&
            h("img", {
              src: picture,
              alt: "",
              onLoad: () => setLoaded(picture),
              onError: () => setLoaded(null),
              style: {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: loaded === picture ? 1 : 0,
              },
            }),
          h(
            "div",
            {
              style: {
                position: "absolute",
                insetInline: "var(--space-4)",
                top: "var(--space-4)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              },
            },
            h(Avatar, { name, src: picture, size: "large" }),
            h("strong", { className: "dark text-heading font-bold text-standard" }, "Marmot ID"),
            h(
              "span",
              { style: { marginInlineStart: "auto", display: "inline-flex" }, title: "End-to-end encryption key" },
              h(LockIcon, { size: "1.25rem" }),
            ),
          ),
        ),
        h(
          "div",
          {
            style: {
              color: "var(--text-standard)",
              padding: "var(--space-4)",
              display: "grid",
              gap: "var(--space-1)",
              background: "var(--surface-inset)",
            },
          },
          h(
            "span",
            {
              className: "text-caption text-subtle",
              style: { paddingBlock: "var(--space-half)", textAlign: "center" },
            },
            "PUBLIC KEY",
          ),
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns:
                  "minmax(var(--space-5), 1fr) minmax(0, max-content) minmax(var(--space-5), 1fr)",
                alignItems: "center",
                gap: "var(--space-1)",
              },
            },
            h("code", { className: "text-mono-lg", style: { gridColumn: 2 } }, npub ? abbreviated(npub) : "…"),
            npub &&
              h(
                "button",
                {
                  type: "button",
                  "aria-label": "Copy Marmot ID",
                  title: copied ? "Copied" : "Copy your full Marmot ID (npub)",
                  onClick: async () => {
                    await copy(npub);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  },
                  style: {
                    gridColumn: 3,
                    justifySelf: "start",
                    display: "inline-grid",
                    placeItems: "center",
                    width: "1.5rem",
                    height: "1.5rem",
                    border: 0,
                    borderRadius: "var(--radius-icon-button, var(--radius-control))",
                    background: "transparent",
                    color: "var(--text-subtle)",
                    cursor: "pointer",
                  },
                },
                copied
                  ? h(Svg, { size: "0.875rem" }, h("path", { d: "M5 12l5 5L20 7" }))
                  : h(
                      Svg,
                      { size: "0.875rem" },
                      h("rect", { x: 9, y: 9, width: 12, height: 12, rx: 2 }),
                      h("path", { d: "M5 15V5a2 2 0 0 1 2-2h10" }),
                    ),
              ),
          ),
        ),
      ),
    );
  }
  return { bindingText, abbreviated, MarmotIdCard };
}
