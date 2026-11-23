// The New chat "To:" bar: people search, pasted keys and recipient chips.
import { typedKey } from "../people/keys.js";
import { PEOPLE_SEARCH_MAX_LENGTH } from "../shared/constants.js";
import { shortKey } from "../shared/format.js";

/** Builds this feature on the plugin's shared `env` (see src/main.js). */
export function createToField(env) {
  const { React, h, viewer, resolveKey, emptyProfiles, avatarSrc, LockIcon, Avatar, subtle } = env;

  // ---- New chat: Buzz's New message view -------------------------------------

  /** The "To:" bar of Buzz's New message view, searching Buzz's people
   * directory (`session.directMessages.people`). */
  function ToField({ relay, state, selected, onChange, disabled, onTyped, onComplete }) {
    const [query, setQuery] = React.useState("");
    const [open, setOpen] = React.useState(true);
    const [result, setResult] = React.useState({ people: [], loading: true, note: "" });
    const [active, setActive] = React.useState(0);
    const input = React.useRef(null);
    const me = viewer();
    const bound = React.useMemo(
      () => new Set(Object.values(state.directory)),
      [state.directory],
    );
    React.useEffect(() => {
      onTyped(!!query.trim());
    }, [query]);
    React.useEffect(() => {
      if (!open) return;
      const controller = new AbortController();
      const typed = query.trim();
      const key = typedKey(typed);
      const timer = setTimeout(async () => {
        setResult((current) => ({ ...current, loading: true, note: "", lookup: !!key }));
        try {
          let found;
          if (key) found = await resolveKey(key, controller.signal);
          else if (/^(nostr:)?npub1/i.test(typed))
            found = { people: [], note: "Paste a whole npub or 64-character hex key." };
          else if (typed.length > PEOPLE_SEARCH_MAX_LENGTH) found = { people: [] };
          else {
            const read = relay?.directMessages?.people;
            if (typeof read === "function") {
              found = { people: (await read(typed, 1, controller.signal)).people ?? [] };
            } else {
              const wanted = typed.toLowerCase();
              found = {
                people: [...(relay?.profiles?.snapshot?.() ?? emptyProfiles)]
                  .map(([pubkey, profile]) => ({ ...profile, pubkey }))
                  .filter((person) => (person.name ?? "").toLowerCase().includes(wanted)),
              };
            }
          }
          if (controller.signal.aborted) return;
          setResult({ people: found.people, loading: false, note: found.note ?? "" });
          setActive(0);
        } catch {
          // Buzz's search errors are its own wording; an empty list says enough.
          if (!controller.signal.aborted) setResult({ people: [], loading: false, note: "" });
        }
      }, typed ? 150 : 0);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }, [relay, query, open]);
    const picked = new Set(selected.map((person) => person.pubkey));
    const options = result.people.filter(
      (person) => person.pubkey !== me && !picked.has(person.pubkey) && !person.isAgent,
    );
    const pick = (person) => {
      onChange([...selected, person]);
      setQuery("");
      setOpen(false);
      onComplete();
    };
    const remove = (pubkey) => {
      onChange(selected.filter((person) => person.pubkey !== pubkey));
      input.current?.focus();
    };
    const onKeyDown = (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
        setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter" && open && options[active]) {
        event.preventDefault();
        pick(options[active]);
      } else if (event.key === "Escape") {
        setOpen(false);
      } else if (event.key === "Backspace" && !query && selected.length) {
        remove(selected.at(-1).pubkey);
      }
    };
    const id = "marmot-new-chat-to";
    return h(
      "div",
      {
        style: {
          margin: 0,
          minWidth: 0,
          position: "relative",
          zIndex: 3,
          padding: "var(--space-4) var(--space-6)",
          borderBottom: "1px solid var(--border-standard)",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            minHeight: "2rem",
            cursor: "text",
          },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              input.current?.focus();
            }
          },
        },
        h(
          "label",
          {
            htmlFor: id,
            className: "text-body-sm",
            style: { ...subtle, marginRight: "var(--space-1)" },
          },
          "To:",
        ),
        selected.map((person) =>
          h(
            "span",
            {
              key: person.pubkey,
              className: "text-body-sm",
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding:
                  "var(--space-chip-inset) var(--space-2) var(--space-chip-inset) var(--space-chip-inset)",
                maxWidth: "15rem",
                borderRadius: "var(--radius-pill)",
                background: "var(--surface-inset)",
              },
            },
            h(Avatar, {
              name: person.name,
              src: avatarSrc(relay, person.picture),
              size: "small",
            }),
            h(
              "span",
              { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              person.name || shortKey(person.pubkey),
            ),
            h(
              "button",
              {
                type: "button",
                disabled,
                "aria-label": `Remove ${person.name || "person"}`,
                onClick: () => remove(person.pubkey),
                style: {
                  display: "grid",
                  placeItems: "center",
                  width: "1.375rem",
                  height: "1.375rem",
                  border: 0,
                  padding: 0,
                  borderRadius: "var(--radius-pill)",
                  background: "transparent",
                  color: "var(--text-subtle)",
                  cursor: "pointer",
                },
              },
              "×",
            ),
          ),
        ),
        h("input", {
          ref: input,
          id,
          autoFocus: true,
          autoComplete: "off",
          role: "combobox",
          "aria-expanded": open,
          "aria-controls": `${id}-people`,
          disabled,
          value: query,
          placeholder: selected.length ? "" : "Find a person…",
          className: "text-body-sm",
          onChange: (event) => {
            setQuery(event.target.value);
            setOpen(true);
          },
          onFocus: () => setOpen(true),
          onBlur: () => setTimeout(() => setOpen(false), 120),
          onKeyDown,
          style: {
            flex: 1,
            minWidth: "8.75rem",
            width: "8.75rem",
            padding: "var(--space-1) 0",
            border: 0,
            outline: "none",
            background: "transparent",
            color: "var(--text-standard)",
          },
        }),
        h(
          "span",
          {
            title: "End-to-end encrypted with Marmot",
            "data-testid": "marmot-encrypted",
            style: { ...subtle, display: "inline-flex", marginInlineStart: "auto" },
          },
          h(LockIcon, { size: "0.875rem" }),
        ),
      ),
      open &&
        !disabled &&
        h(
          "div",
          {
            id: `${id}-people`,
            role: "listbox",
            "aria-label": "People",
            style: {
              position: "absolute",
              top: "calc(100% - var(--space-2))",
              insetInlineStart: "var(--space-6)",
              width: "min(23.75rem, calc(100% - 2 * var(--space-6)))",
              maxHeight: "min(25rem, 50vh)",
              overflowY: "auto",
              overscrollBehavior: "contain",
              padding: "var(--space-1)",
              borderRadius: "var(--radius-floating, var(--radius-card))",
              border: "1px solid var(--border-standard)",
              background: "var(--surface-popover)",
              boxShadow: "var(--shadow-lg, var(--shadow-md))",
              color: "var(--text-standard)",
              zIndex: "var(--layer-popover)",
            },
          },
          options.map((person, index) =>
            h(
              "div",
              {
                key: person.pubkey,
                role: "option",
                "aria-selected": index === active,
                onMouseDown: (event) => {
                  event.preventDefault();
                  pick(person);
                },
                onMouseEnter: () => setActive(index),
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-row-gap, var(--space-2))",
                  minHeight: "var(--size-row)",
                  padding: "var(--space-1) var(--space-control-inset)",
                  borderRadius: "var(--radius-row)",
                  cursor: "pointer",
                  background:
                    index === active ? "var(--affordance-subtle-hover)" : "transparent",
                },
              },
              h(Avatar, { name: person.name, src: avatarSrc(relay, person.picture) }),
              h(
                "span",
                {
                  className: "text-body-sm",
                  style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                },
                person.name || shortKey(person.pubkey),
              ),
              bound.has(person.pubkey) &&
                h(
                  "span",
                  { title: "Has a Marmot ID", style: { ...subtle, display: "inline-flex" } },
                  h(LockIcon, { size: "0.75rem" }),
                ),
            ),
          ),
          !options.length &&
            h(
              "p",
              { className: "text-body-sm", style: { ...subtle, padding: "var(--space-3)", margin: 0 } },
              result.note ||
                (result.loading
                  ? result.lookup
                    ? "Looking up this key…"
                    : "Searching people…"
                  : "No people found."),
            ),
        ),
    );
  }
  return { ToField };
}
