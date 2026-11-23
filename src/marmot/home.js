// Per-identity wn homes and their Keychain service names.
import { ENV, HOME_ROOT, KEYCHAIN_SERVICE_PREFIX, RELAY_SET } from "../shared/constants.js";

export function homeFor(viewer) {
  const id = (viewer ?? "")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 16);
  return id.length === 16 ? `${HOME_ROOT}/${RELAY_SET}/${id}` : null;
}

export function envFor(home) {
  return { ...ENV, WN_KEYCHAIN_SERVICE: `${KEYCHAIN_SERVICE_PREFIX}${home.split("/").at(-1)}` };
}
