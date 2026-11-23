// Spawning `wn` through the host: queued JSON calls and NDJSON streams.
import { failure, parseEnvelope } from "./envelope.js";
import { envFor } from "./home.js";
import { COMMAND_TIMEOUT_MS, MAX_PARALLEL } from "../shared/constants.js";

/** Runs `wn --home . --json …` in `cwd` (the identity's home) and parses its
 * envelope. Errors are JSON on stdout too, with a nonzero exit. */
export function createRunner(host, cwd) {
  let active = 0;
  const waiting = [];
  async function slot(task) {
    while (active >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  }
  function spawn(args, onStdout, onStderr) {
    if (typeof host.spawn !== "function")
      throw new Error("This Buzz build cannot start processes.");
    return host.spawn("wn", {
      args: ["--home", ".", "--json", ...args],
      cwd,
      env: envFor(cwd),
      onStdout,
      onStderr,
    });
  }
  function run(args) {
    return slot(async () => {
      let stdout = "";
      let stderr = "";
      let child;
      try {
        child = await spawn(
          args,
          (data) => {
            stdout += data;
          },
          (data) => {
            stderr += data;
          },
        );
      } catch (error) {
        return failure(
          "spawn_failed",
          `Could not start wn: ${error?.message ?? error}`,
        );
      }
      child.end().catch(() => {});
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), COMMAND_TIMEOUT_MS);
      });
      const code = await Promise.race([child.exited, timeout]);
      clearTimeout(timer);
      if (code === "timeout") {
        child.kill();
        return failure("timeout", `wn ${args.join(" ")} took too long`);
      }
      return parseEnvelope(stdout, stderr, code);
    });
  }
  /** A long-lived NDJSON subscription; stdout arrives in arbitrary chunks. */
  async function stream(args, onRecord, onExit) {
    let buffer = "";
    const child = await spawn(args, (data) => {
      buffer += data;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        onRecord(record);
      }
    });
    child.exited.then((code) => onExit?.(code));
    return child;
  }
  return { run, stream };
}
