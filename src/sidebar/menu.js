// The Encrypted messages "…" menu, drawn in plain DOM with Buzz's global menu classes.

export const SVG_NS = "http://www.w3.org/2000/svg";
// Tabler paths of the icons Buzz's DM menu uses; `fill` marks a solid shape.
export const MENU_GLYPHS = {
  filter: ["M4 6h16", "M6 12h12", "M9 18h6"],
  sort: ["M17 3l0 18", "M10 18l-3 3l-3 -3", "M7 21l0 -18", "M20 6l-3 -3l-3 3"],
  all: [
    "M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10",
    "M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2",
  ],
  unreads: [
    "M13 4.2c-2.3-.3-4.7.3-6.6 1.6C2.9 8.3 2 12.7 4.3 16.1L3 20l4.7-1c4 1.9 8.9.9 11.6-2.3 1.4-1.7 2-3.7 1.7-5.7",
    { d: "M16 5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", fill: true },
  ],
  recent: ["M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0", "M14.5 10.5l-2.5 2.5", "M17 8l1 -1", "M14 3h-4"],
  alpha: ["M14 15.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0", "M3 19v-10.5a3.5 3.5 0 0 1 7 0v10.5", "M3 13h7", "M21 12v7"],
  copy: [
    "M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
    "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1",
  ],
  tag: [
    "M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3z",
  ],
  next: ["M9 6l6 6l-6 6"],
  check: ["M5 12l5 5l10 -10"],
};

export function glyph(doc, name, size) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, String(value));
  for (const part of MENU_GLYPHS[name] ?? []) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", typeof part === "string" ? part : part.d);
    if (part.fill) {
      path.setAttribute("fill", "currentColor");
      path.setAttribute("stroke", "none");
    }
    svg.append(path);
  }
  return svg;
}

/**
 * Opens a menu under `anchor` and returns its close function. Entries:
 * `{ kind: "choices", label, icon, value, choices: [{ value, label, icon }], change }`
 * (a submenu of radio items), `{ kind: "check", label, icon, checked, change }`,
 * `{ kind: "item", label, icon, disabled?, run }` and `{ kind: "separator" }`.
 */
export function openMenu(anchor, title, entries, onClosed) {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView;
  const label = `More actions for ${title}`;
  const frame = (callback) =>
    win.requestAnimationFrame ? win.requestAnimationFrame(callback) : win.setTimeout(callback, 16);
  const EDGE = 8;
  const layers = [];
  let sub = null;
  let closed = false;

  const enabled = (layer) => layer.items.filter((item) => !item.hasAttribute("data-disabled"));
  const highlight = (layer, item, focus) => {
    for (const other of layer.items) other.toggleAttribute("data-highlighted", other === item);
    if (item && focus) item.focus({ preventScroll: true });
  };
  const dismiss = (layer) => {
    layer.popup.setAttribute("data-ending-style", "");
    win.setTimeout(() => layer.positioner.remove(), 150);
  };

  const layer = (side, rect, ariaLabel, build) => {
    const positioner = doc.createElement("div");
    positioner.className = "buzz-menu-positioner";
    Object.assign(positioner.style, { position: "fixed", left: "0", top: "0", visibility: "hidden" });
    const popup = doc.createElement("div");
    popup.className = "buzz-menu-popup text-body-sm";
    popup.setAttribute("data-buzz-ui", "");
    popup.setAttribute("data-size", "default");
    popup.setAttribute("data-side", side);
    popup.setAttribute("role", "menu");
    popup.setAttribute("aria-label", ariaLabel);
    popup.tabIndex = -1;
    popup.style.setProperty("--available-height", `${win.innerHeight - 2 * EDGE}px`);
    popup.style.setProperty("--available-width", `${win.innerWidth - 2 * EDGE}px`);
    popup.style.setProperty("--transform-origin", side === "bottom" ? "top right" : "top left");
    positioner.append(popup);
    doc.body.append(positioner);
    const entry = { positioner, popup, items: [] };
    build(entry);
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    let left = side === "bottom" ? rect.right - width : rect.right + 4;
    let top = side === "bottom" ? rect.bottom + 4 : rect.top - 4;
    if (side === "right" && left + width > win.innerWidth - EDGE) left = rect.left - 4 - width;
    if (side === "bottom" && top + height > win.innerHeight - EDGE) top = rect.top - 4 - height;
    left = Math.max(EDGE, Math.min(left, win.innerWidth - EDGE - width));
    top = Math.max(EDGE, Math.min(top, win.innerHeight - EDGE - height));
    Object.assign(positioner.style, { left: `${left}px`, top: `${top}px`, visibility: "" });
    popup.setAttribute("data-starting-style", "");
    frame(() => frame(() => popup.removeAttribute("data-starting-style")));
    popup.addEventListener("keydown", (event) => keys(entry, event));
    layers.push(entry);
    return entry;
  };

  const item = (into, { role = "menuitem", icon, text, disabled, checked, trailing }) => {
    const el = doc.createElement("div");
    el.className = "buzz-menu-item";
    el.setAttribute("role", role);
    el.tabIndex = -1;
    if (disabled) {
      el.setAttribute("data-disabled", "");
      el.setAttribute("aria-disabled", "true");
    }
    const iconEl = doc.createElement("span");
    iconEl.className = "buzz-menu-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.append(glyph(doc, icon, 14));
    if (role === "menuitemradio" || role === "menuitemcheckbox") {
      if (role === "menuitemradio") el.setAttribute("data-selection", "check");
      el.setAttribute("aria-checked", String(!!checked));
      el.toggleAttribute("data-checked", !!checked);
      const choice = doc.createElement("span");
      choice.className = "buzz-menu-choice-label";
      choice.append(iconEl, text);
      const indicator = doc.createElement("span");
      indicator.className = "buzz-menu-item-indicator";
      indicator.toggleAttribute("data-checked", !!checked);
      indicator.append(glyph(doc, "check", 16));
      el.append(choice, indicator);
    } else {
      el.append(iconEl, text);
      if (trailing) el.append(trailing);
    }
    el.addEventListener("pointermove", () => {
      if (!el.hasAttribute("data-highlighted") && !disabled) highlight(into, el, true);
    });
    into.items.push(el);
    into.popup.append(el);
    return el;
  };

  const closeSub = (focusTrigger) => {
    if (!sub) return;
    dismiss(sub.layer);
    layers.splice(layers.indexOf(sub.layer), 1);
    sub.trigger.removeAttribute("data-popup-open");
    sub.trigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) highlight(root, sub.trigger, true);
    sub = null;
  };
  const openSub = (trigger, entry, focusFirst) => {
    if (sub?.trigger !== trigger) {
      closeSub(false);
      trigger.setAttribute("data-popup-open", "");
      trigger.setAttribute("aria-expanded", "true");
      const submenu = layer("right", trigger.getBoundingClientRect(), `${entry.label} ${title}`, (into) => {
        for (const choice of entry.choices) {
          const el = item(into, { role: "menuitemradio", icon: choice.icon, text: choice.label, checked: choice.value === entry.value });
          el.addEventListener("click", () => {
            entry.change(choice.value);
            close(true);
          });
        }
      });
      sub = { layer: submenu, trigger };
    }
    if (focusFirst) highlight(sub.layer, enabled(sub.layer)[0], true);
  };

  const close = (restoreFocus) => {
    if (closed) return;
    closed = true;
    closeSub(false);
    for (const each of layers) dismiss(each);
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("scroll", scrolled, true);
    win.removeEventListener("blur", blurred);
    win.removeEventListener("resize", blurred);
    anchor.setAttribute("aria-expanded", "false");
    anchor.removeAttribute("data-popup-open");
    if (restoreFocus) anchor.focus({ preventScroll: true });
    onClosed();
  };

  function keys(at, event) {
    const items = enabled(at);
    const current = items.indexOf(doc.activeElement);
    const go = (index) => highlight(at, items[(index + items.length) % items.length], true);
    const isSub = at !== root;
    switch (event.key) {
      case "ArrowDown":
        go(current < 0 ? 0 : current + 1);
        break;
      case "ArrowUp":
        go(current < 0 ? -1 : current - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(-1);
        break;
      case "Enter":
      case " ":
        if (current >= 0) items[current].click();
        break;
      case "ArrowRight":
        if (!isSub && current >= 0 && items[current].getAttribute("aria-haspopup") === "menu") items[current].click();
        break;
      case "ArrowLeft":
        if (isSub) closeSub(true);
        break;
      case "Escape":
        if (isSub) closeSub(true);
        else close(true);
        break;
      case "Tab":
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
  function outside(event) {
    if (anchor.contains(event.target) || layers.some((each) => each.positioner.contains(event.target))) return;
    close(false);
  }
  function scrolled(event) {
    if (!layers.some((each) => each.positioner.contains(event.target))) close(false);
  }
  function blurred() {
    close(false);
  }

  const root = layer("bottom", anchor.getBoundingClientRect(), label, (into) => {
    for (const entry of entries) {
      if (entry.kind === "separator") {
        const line = doc.createElement("div");
        line.className = "buzz-menu-separator";
        line.setAttribute("role", "separator");
        into.popup.append(line);
        continue;
      }
      if (entry.kind === "choices") {
        const arrow = doc.createElement("span");
        arrow.className = "buzz-menu-submenu-arrow";
        arrow.append(glyph(doc, "next", 14));
        const el = item(into, { icon: entry.icon, text: entry.label, trailing: arrow });
        el.setAttribute("aria-haspopup", "menu");
        el.setAttribute("aria-expanded", "false");
        el.addEventListener("pointerenter", () => openSub(el, entry, false));
        el.addEventListener("click", () => openSub(el, entry, true));
        continue;
      }
      if (entry.kind === "check") {
        const el = item(into, { role: "menuitemcheckbox", icon: entry.icon, text: entry.label, checked: entry.checked });
        el.addEventListener("pointerenter", () => closeSub(false));
        el.addEventListener("click", () => {
          close(true);
          entry.change(!entry.checked);
        });
        continue;
      }
      const el = item(into, { icon: entry.icon, text: entry.label, disabled: entry.disabled });
      el.addEventListener("pointerenter", () => closeSub(false));
      el.addEventListener("click", () => {
        if (entry.disabled) return;
        close(true);
        entry.run();
      });
    }
  });
  anchor.setAttribute("aria-haspopup", "menu");
  anchor.setAttribute("aria-expanded", "true");
  anchor.setAttribute("data-popup-open", "");
  root.popup.focus({ preventScroll: true });
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("scroll", scrolled, true);
  win.addEventListener("blur", blurred);
  win.addEventListener("resize", blurred);
  return close;
}
