// Sidebar row avatars that also mark unread rows the way DM rows look.
/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createRowIcon(env) {
  const { React, h, Avatar } = env;

  // ---- sidebar ------------------------------------------------------------

  /**
   * A row's avatar that also marks its row unread the way DM rows look.
   * Section rows have no unread field and only the icon is ours, so it styles
   * its own host row: semibold name in the unread ink (the selected ink when
   * selected) and the DM's trailing dot.
   */
  function RowIcon({ unread, ...avatar }) {
    const ref = React.useRef(null);
    React.useLayoutEffect(() => {
      const item = ref.current?.closest(".navigation-item");
      const label = item?.querySelector(".navigation-item-label");
      if (!unread || !item || !label) return undefined;
      const dot = document.createElement("span");
      dot.setAttribute("data-marmot-unread", "");
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", "Unread messages");
      Object.assign(dot.style, {
        display: "block",
        flexShrink: "0",
        width: "0.375rem",
        height: "0.375rem",
        marginInlineStart: "auto",
        borderRadius: "50%",
        background: "var(--affordance-prominent-mark)",
      });
      item.append(dot);
      const emphasize = () => {
        label.style.fontWeight = "var(--type-weight-semibold)";
        label.style.color = item.hasAttribute("data-selected") ? "" : "var(--text-navigation-unread)";
      };
      emphasize();
      const watch = new MutationObserver(emphasize);
      watch.observe(item, { attributes: true, attributeFilter: ["data-selected"] });
      return () => {
        watch.disconnect();
        dot.remove();
        label.style.removeProperty("font-weight");
        label.style.removeProperty("color");
      };
    }, [unread]);
    return h("span", { ref, style: { display: "contents" } }, h(Avatar, { ...avatar, size: "compact" }));
  }
  return { RowIcon };
}
