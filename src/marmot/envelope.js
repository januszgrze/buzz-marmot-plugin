// wn's JSON envelope: parsing `--json` output and turning errors into text.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const failure = (code, message) => ({ ok: false, error: { code, message } });

export function parseEnvelope(stdout, stderr, exitCode) {
  const lines = stdout.split("\n").map((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!lines[index].startsWith("{")) continue;
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value.ok === "boolean") return value;
    } catch {}
  }
  const detail = (stderr || stdout).trim().slice(-600);
  return failure(
    "bad_output",
    detail || `wn exited with ${exitCode ?? "a signal"} and printed nothing`,
  );
}

export function errorText(error) {
  if (!error) return "Unknown error";
  return error.code ? `${error.message} (${error.code})` : error.message;
}
