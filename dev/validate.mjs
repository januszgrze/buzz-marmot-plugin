// Checks plugin/ against the rules Buzz's installer enforces
// (buzz-app crates/plugin-manager/src/lib.rs `Manifest::validate`) and the
// authoring guide's module contract, without building buzzodz.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../plugin/", import.meta.url));
const problems = [];
const check = (ok, message) => ok || problems.push(message);

const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, "utf8"));
const validId = (id) =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 80 &&
  /^[a-z][a-z0-9.-]*$/.test(id) &&
  !id.split(/[.-]/).some((part) => part === "");
const bytes = (s) => Buffer.byteLength(s, "utf8");

check(
  Object.keys(manifest).every((k) =>
    ["id", "name", "apiVersion", "description", "updates", "discovery", "host"].includes(k),
  ),
  "unknown top-level manifest key",
);
check(validId(manifest.id), `invalid id ${manifest.id}`);
check(!/^buzz\./.test(manifest.id), "buzz.* ids are reserved for bundled plugins");
check(typeof manifest.name === "string" && manifest.name.trim() && bytes(manifest.name) <= 80, "name must be 1-80 bytes");
check(manifest.apiVersion === 1, "apiVersion must be 1");
if (manifest.description !== undefined)
  check(manifest.description.trim() && bytes(manifest.description) <= 280, "description must be 1-280 bytes");
const host = manifest.host ?? {};
const hostKeys = ["federatedIdentity", "agentHooks", "agentExecution", "commands", "networkOrigins", "processes", "mcp", "files", "managedFiles", "publicImages", "publicPages"];
check(Object.keys(host).every((k) => hostKeys.includes(k)), "unknown host key");
for (const process of host.processes ?? []) {
  check(Object.keys(process).every((k) => ["id", "program", "args", "bundled", "artifact"].includes(k)), "unknown process key");
  check(/^[a-z0-9][a-z0-9._-]*$/.test(process.id), `invalid process id ${process.id}`);
  check(/^[A-Za-z0-9._-]{1,80}$/.test(process.program), `invalid program ${process.program}`);
  check((process.args ?? []).length <= 16, "too many process args");
}
check((host.processes ?? []).length <= 16, "too many processes");

const code = readFileSync(`${dir}plugin.js`, "utf8");
check(statSync(`${dir}plugin.js`).size < 8 * 1024 * 1024, "plugin.js exceeds 8 MiB");
check(!/^\s*import\s/m.test(code) && !/\bimport\s*\(/.test(code), "plugin.js must not import anything");
check(/export const inject\s*=/.test(code) && /export function apply\s*\(/.test(code), "plugin.js must export inject and apply");
for (const optional of ["sidebarSections", "ui", "subjectLift", "pluginInstaller", "seen"])
  check(!new RegExp(`inject = \\[[^\\]]*"${optional}"`).test(code), `${optional} is optional: read it with ctx.reflect.get`);
const textSizes = code.match(/fontSize:\s*"[^"]+"/g) ?? [];
const zoomSafe = (s) => /(rem|var\(--text-[a-z0-9-]+\))"$/.test(s);
check(textSizes.every(zoomSafe), `non-rem font sizes: ${textSizes.filter((s) => !zoomSafe(s))}`);
const repoUrls = [...code.matchAll(/const PLUGIN_REPO_URL = "([^"]*)"/g)];
check(repoUrls.length === 1 && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(repoUrls[0][1]), "PLUGIN_REPO_URL must be one https://github.com/<owner>/<repo> constant");
const relays = code.match(/const MARMOT_RELAYS = Object\.freeze\(\[([^\]]*)\]\);/)?.[1].match(/"[^"]*"/g) ?? [];
check(relays.length > 0 && relays.every((url) => /^"wss:\/\/[^"/]+\/?"$/.test(url)), "MARMOT_RELAYS must list public wss:// relays");
check(!/127\.0\.0\.1|localhost|WN_ALLOW_LOOPBACK_RELAYS/.test(code), "plugin.js must not refer to loopback relays (the harness patches them in)");
check(/WN_SECRET_STORE: "keychain"/.test(code), "account keys belong in the Keychain (WN_SECRET_STORE: \"keychain\")");
const communityTag = code.match(/const COMMUNITY_TAG = "([^"]+)";/)?.[1];
const communityLine = code.match(/const COMMUNITY_LINE = \/(.+)\/m;/)?.[1];
check(
  communityTag && communityLine && new RegExp(communityLine, "m").exec(`about\n${communityTag} wss://a.example:444`)?.[1] === "wss://a.example:444",
  "COMMUNITY_LINE must read the relay URL from a COMMUNITY_TAG line",
);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
check(communityTag && readme.includes(`${communityTag} wss://`), "README must document the community tag encoding");
// Stock Buzz 1.0 only: no plugin APIs that exist only in unreleased Buzz builds.
for (const [pattern, name] of [
  [/\bcreate:\s*\{/, "page `create` (New menu entry)"],
  [/RecipientPicker/, "conversation.ui.RecipientPicker"],
  [/composerMarkdown/, "conversation.format.composerMarkdown"],
  [/identityCard/, "settings identityCard"],
  [/NewMessageLayout|\bTranscript\b|attachmentsUnavailable|\borganize:/, "unreleased sidebar/layout/composer options"],
  [/\.registerSource\b|\.registerContext\b|\bmenuActions\b/, "bundled-only sidebar APIs (sources, contexts, host menu actions)"],
])
  check(!pattern.test(code), `uses ${name}, which stock Buzz 1.0 lacks`);

if (problems.length) {
  console.error(`plugin/ is invalid:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`plugin/ ok: ${manifest.id} ${manifest.name}, plugin.js ${(statSync(`${dir}plugin.js`).size / 1024).toFixed(1)} KiB`);
