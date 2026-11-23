// wn chat and message records as the plugin's rows.
import { chatCommunity } from "../community/tag.js";

export function chatRow(chat) {
  return {
    id: chat.group_id,
    name: chat.profile?.name?.trim() || "Untitled chat",
    description: chat.profile?.description?.trim() || "",
    community: chatCommunity(chat.profile?.description),
    unread: chat.unread_count || 0,
    last: chat.last_message?.plaintext ?? "",
    at: chat.activity_sort_at || 0,
    pending: !!chat.pending_confirmation,
  };
}

export function messageRow(message) {
  return {
    id: message.message_id,
    from: message.from,
    own: message.direction === "sent",
    text: message.plaintext ?? "",
    at: message.received_at || message.recorded_at || 0,
  };
}
