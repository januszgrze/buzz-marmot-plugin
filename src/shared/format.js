// Small display formatting helpers.

export function shortKey(key) {
  return key ? `${key.slice(0, 10)}…${key.slice(-6)}` : "";
}
