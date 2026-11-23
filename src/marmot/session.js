// One identity's wn session: daemon lifecycle, account, feeds, polling and chat actions.
import { errorText, failure, sleep } from "./envelope.js";
import { chatRow, messageRow } from "./rows.js";
import { createRunner } from "./runner.js";
import { CHAT_KIND, COMMUNITY_TAG, CREATE_ATTEMPTS, HEX, HEX_KEY, HISTORY_LIMIT, MARMOT_RELAYS, POLL_MS, RELAY_SETTLE_MS, STREAM_RESTART_MS } from "../shared/constants.js";
import { shortKey } from "../shared/format.js";

export const INITIAL = Object.freeze({
  phase: "waiting", // waiting | starting | ready | failed
  step: "Waiting for your Buzz identity…",
  error: null,
  home: null,
  account: null,
  relayListsComplete: true,
  chats: [],
  invites: [],
  selected: null,
  messages: {},
  members: {},
  notice: null,
  binding: "pending", // pending | published | unsupported | failed
  bindingError: null,
  // Marmot account hex -> Buzz pubkey, from published bindings.
  directory: {},
});

/** Owns one identity's daemon, account, feeds and polling. */
export function createSession(host, home, store, hooks) {
  const wn = createRunner(host, home);
  const set = store.set;
  let stopped = false;
  let chatFeed = null;
  let messageFeed = null;
  let messageFeedGroup = null;
  let poll = null;
  let refreshTimer = null;
  const membersLoading = new Set();
  const account = () => store.get().account;
  const as = (...args) => ["--account", account().id, ...args];

  function fail(error, step) {
    if (stopped) return;
    set({ phase: "failed", error, step: step ?? store.get().step });
  }

  async function findAccount() {
    const listed = await wn.run(["accounts", "list"]);
    if (!listed.ok) return listed;
    const found = listed.result.accounts.find((a) => a.local_signing);
    return { ok: true, result: found ?? null };
  }

  async function createAccount() {
    let last = null;
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
      const created = await wn.run(["create-identity"]);
      if (created.ok && created.result.relay_lists?.complete) return created;
      last = created;
      // A half-made new account cannot be repaired by the CLI; remove it.
      const leftover = await findAccount();
      if (leftover.ok && leftover.result)
        await wn.run(["logout", leftover.result.account_id]);
      await sleep(RELAY_SETTLE_MS);
    }
    return last.ok
      ? failure(
          "relay_lists_incomplete",
          "Could not publish the new account's relay lists",
        )
      : last;
  }

  async function start() {
    set({
      ...INITIAL,
      phase: "starting",
      home,
      step: "Checking the Marmot daemon…",
    });
    const status = await wn.run(["daemon", "status"]);
    if (stopped) return;
    if (!status.ok) return fail(status.error);
    let justStarted = false;
    if (!status.result.running) {
      set({ step: "Starting the Marmot daemon…" });
      const started = await wn.run([
        "daemon",
        "start",
        "--discovery-relays",
        MARMOT_RELAYS.join(","),
        "--default-account-relays",
        MARMOT_RELAYS.join(","),
      ]);
      if (stopped) return;
      if (!started.ok) return fail(started.error);
      justStarted = true;
    }
    set({ step: "Loading your Marmot account…" });
    const found = await findAccount();
    if (stopped) return;
    if (!found.ok) return fail(found.error);
    let summary = found.result;
    if (!summary) {
      set({ step: "Creating your Marmot account…" });
      if (justStarted) await sleep(RELAY_SETTLE_MS);
      const created = await createAccount();
      if (stopped) return;
      if (!created.ok) return fail(created.error);
      summary = created.result;
    }
    const accountStatus = await wn.run([
      "accounts",
      "status",
      summary.account_id,
    ]);
    if (stopped) return;
    set({
      phase: "ready",
      step: "",
      account: { id: summary.account_id, npub: summary.npub },
      relayListsComplete: accountStatus.ok
        ? accountStatus.result.relay_lists?.complete !== false
        : true,
    });
    hooks.ready();
    await refresh();
    startChatFeed();
    // The daemon's own subscriptions can be slow to pick up a welcome for a
    // brand-new account; an explicit sync is cheap and catches it up.
    poll = setInterval(async () => {
      await wn.run(as("sync"));
      await refresh();
      hooks.poll();
    }, POLL_MS);
    const selected = store.get().selected;
    if (selected) void openChat(selected);
  }

  async function refresh() {
    if (stopped || !account()) return;
    const [chats, invites] = await Promise.all([
      wn.run(as("chats", "list")),
      wn.run(as("groups", "invites")),
    ]);
    if (stopped) return;
    const patch = {};
    if (chats.ok)
      patch.chats = chats.result.chats
        .map(chatRow)
        .sort((a, b) => b.at - a.at);
    if (invites.ok) patch.invites = invites.result.invites.map(chatRow);
    const error = (!chats.ok && chats.error) || (!invites.ok && invites.error);
    patch.notice = error ? errorText(error) : null;
    set(patch);
    // Names and avatars come from each chat's other members.
    const known = store.get().members;
    for (const chat of [...(patch.chats ?? []), ...(patch.invites ?? [])])
      if (!known[chat.id]) void loadMembers(chat.id);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 400);
  }

  async function startChatFeed() {
    if (stopped) return;
    try {
      chatFeed = await wn.stream(
        as("chats", "subscribe"),
        (record) => {
          if (record.result?.type === "chat") scheduleRefresh();
        },
        () => {
          chatFeed = null;
          if (!stopped) setTimeout(startChatFeed, STREAM_RESTART_MS);
        },
      );
      if (stopped) chatFeed.kill();
    } catch {
      if (!stopped) setTimeout(startChatFeed, STREAM_RESTART_MS);
    }
  }

  async function loadMessages(groupId) {
    const listed = await wn.run(
      as("messages", "list", groupId, "--limit", HISTORY_LIMIT),
    );
    if (stopped) return;
    if (!listed.ok) return set({ notice: errorText(listed.error) });
    const rows = listed.result.messages
      .filter((m) => m.kind === CHAT_KIND)
      .map(messageRow);
    set((s) => ({ messages: { ...s.messages, [groupId]: rows } }));
  }

  async function loadMembers(groupId) {
    if (membersLoading.has(groupId)) return;
    membersLoading.add(groupId);
    const listed = await wn
      .run(as("groups", "members", groupId))
      .finally(() => membersLoading.delete(groupId));
    if (stopped || !listed.ok) return;
    // Other members' Marmot account ids; this device's own account is local.
    const others = (listed.result.members ?? [])
      .filter((member) => !member.local && HEX_KEY.test(member.member_id ?? ""))
      .map((member) => member.member_id);
    set((s) => ({ members: { ...s.members, [groupId]: others } }));
  }

  function appendMessage(groupId, message) {
    set((s) => {
      const current = s.messages[groupId] ?? [];
      if (current.some((m) => m.id === message.message_id)) return {};
      return {
        messages: {
          ...s.messages,
          [groupId]: [...current, messageRow(message)],
        },
      };
    });
  }

  async function startMessageFeed(groupId) {
    messageFeed?.kill();
    messageFeed = null;
    messageFeedGroup = groupId;
    try {
      const child = await wn.stream(
        as("messages", "subscribe", groupId, "--limit", "0"),
        (record) => {
          const result = record.result;
          if (
            result?.type === "message" &&
            result.message?.kind === CHAT_KIND
          ) {
            appendMessage(groupId, result.message);
            hooks.author(result.message.from);
            if (viewing(groupId)) void markRead(groupId);
          } else if (result?.type === "message_delete") {
            void loadMessages(groupId);
          }
        },
        () => {
          if (messageFeed === child) messageFeed = null;
          if (
            !stopped &&
            messageFeedGroup === groupId &&
            store.get().selected === groupId
          )
            setTimeout(() => {
              if (!messageFeed && store.get().selected === groupId)
                void startMessageFeed(groupId);
            }, STREAM_RESTART_MS);
        },
      );
      if (stopped || messageFeedGroup !== groupId) child.kill();
      else messageFeed = child;
    } catch (error) {
      set({ notice: `Live updates are off: ${error?.message ?? error}` });
    }
  }

  async function openChat(groupId) {
    if (!HEX.test(groupId ?? "")) return;
    set({ selected: groupId });
    if (!account() || stopped) return;
    if (messageFeedGroup !== groupId || !messageFeed)
      void startMessageFeed(groupId);
    await Promise.all([loadMessages(groupId), loadMembers(groupId)]);
    if (viewing(groupId)) await markRead(groupId);
    scheduleRefresh();
  }

  /** On screen: the open chat while the window is visible. */
  function viewing(groupId) {
    return store.get().selected === groupId && globalThis.document?.visibilityState !== "hidden";
  }

  /** wn keeps the read marker per group, so unread survives reloads. */
  async function markRead(groupId) {
    if (!account() || stopped) return;
    set((s) => ({
      chats: s.chats.map((chat) => (chat.id === groupId && chat.unread ? { ...chat, unread: 0 } : chat)),
    }));
    await wn.run(as("chats", "mark-read", groupId));
  }

  function closeChat() {
    set({ selected: null });
  }

  async function send(groupId, text) {
    const sent = await wn.run(as("messages", "send", "--group", groupId, text));
    if (!sent.ok) return errorText(sent.error);
    // Own sends never arrive on the subscription; read them back.
    await loadMessages(groupId);
    scheduleRefresh();
    return null;
  }

  /** Whether `key` (hex) is a Marmot account with a fetchable KeyPackage on
   * its relays: `{ npub }` when it is, `{ missing }` when not, `{ error }`. */
  async function checkKey(key) {
    if (!account() || stopped) return { error: "Marmot is not ready yet." };
    const checked = await wn.run(as("keys", "check", key));
    if (checked.ok && checked.result?.available && checked.result.npub)
      return { npub: checked.result.npub };
    const code = checked.error?.code ?? "";
    if (checked.ok || /missing|not_found|relay_list/.test(code)) return { missing: true };
    return { error: errorText(checked.error) };
  }

  async function accept(groupId) {
    const accepted = await wn.run(as("groups", "accept", groupId));
    if (!accepted.ok) return errorText(accepted.error);
    await refresh();
    void openChat(groupId);
    return null;
  }

  async function decline(groupId) {
    const declined = await wn.run(as("groups", "decline", groupId));
    if (!declined.ok) return errorText(declined.error);
    if (store.get().selected === groupId) set({ selected: null });
    await refresh();
    return null;
  }

  /** Creates a group with `members` (npubs), tagged with `community`, and
   * reports who was not invited. */
  async function createChat(name, members, community) {
    const created = await wn.run(
      as(
        "groups",
        "create",
        `--description=${COMMUNITY_TAG} ${community}`,
        name,
        ...members,
      ),
    );
    if (!created.ok) return { error: errorText(created.error) };
    const groupId = created.result.group_id;
    const skipped = (created.result.member_outcomes ?? []).filter(
      (outcome) => outcome.status !== "selected",
    );
    const warning = skipped.length
      ? `Not invited: ${skipped.map((o) => `${shortKey(o.account_id_hex)} (${o.status})`).join(", ")}`
      : null;
    if (!groupId) return { error: warning ?? "No chat was created" };
    await refresh();
    return { groupId, warning };
  }

  function stop() {
    stopped = true;
    clearInterval(poll);
    clearTimeout(refreshTimer);
    chatFeed?.kill();
    messageFeed?.kill();
  }

  void start().catch((error) =>
    fail({ code: "unexpected", message: String(error?.message ?? error) }),
  );
  return {
    stop,
    refresh,
    openChat,
    closeChat,
    markRead,
    viewing,
    send,
    accept,
    decline,
    createChat,
    checkKey,
  };
}
