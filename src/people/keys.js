// Pasted keys: npub (NIP-19 bech32) and hex decoding, without dependencies.

export const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
export const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** The hex key of a checksummed `npub1…` (NIP-19), or null. */
export function npubToHex(text) {
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return null;
  const value = text.toLowerCase();
  if (value.length !== 63 || !value.startsWith("npub1")) return null;
  const data = [...value.slice(5)].map((c) => BECH32.indexOf(c));
  if (data.some((v) => v < 0)) return null;
  let check = 1;
  for (const v of [3, 3, 3, 3, 0, 14, 16, 21, 2, ...data]) {
    const top = check >>> 25;
    check = ((check & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) check ^= BECH32_GEN[i];
  }
  if (check !== 1) return null;
  let acc = 0;
  let bits = 0;
  let hex = "";
  for (const v of data.slice(0, -6)) {
    acc = ((acc << 5) | v) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      hex += ((acc >> bits) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return hex.length === 64 && bits < 5 && !(acc & ((1 << bits) - 1)) ? hex : null;
}

/** The hex key that pasted text names: 64 hex characters, or an npub with or
 * without `nostr:`. Spaces and invisible characters a copy can carry are
 * dropped. Null for anything else, including a key still being typed. */
export function typedKey(text) {
  const value = String(text ?? "")
    .replace(/[\s\u200b-\u200d\u2060\ufeff]+/g, "")
    .replace(/^nostr:/i, "");
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  return /^npub1/i.test(value) ? npubToHex(value) : null;
}
