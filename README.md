# buzz-marmot-plugin

**Experimental** end-to-end encrypted chats for [Buzz](https://github.com/block/buzz)
using the [Marmot protocol](https://github.com/marmot-protocol/marmot) (MLS over
Nostr). It is a plugin for stock Buzz 1.0 desktop: no Buzz changes needed.
Encrypted chats look and behave like Buzz's own direct messages and group chats.

The plugin contains no cryptography of its own. It drives MDK's `wn` command-line
app and its `wnd` daemon (the [Marmot Development Kit](https://github.com/marmot-protocol/mdk)),
which hold the Marmot key and all MLS state. Buzz never signs Marmot messages, and
Buzz's relay never sees chat contents.

> This is an early, experimental project. Don't rely on it for anything
> sensitive yet. Bug reports and pull requests are welcome.

```
plugin/manifest.json   plugin id marmot.chats; one host grant: the "wn" program
plugin/plugin.js       the built plugin (one ES module; generated, committed)
src/                   the plugin's source, bundled by `npm run build` (esbuild)
dev/validate.mjs       manifest, bundle and source checks that mirror Buzz's installer rules
dev/harness.mjs        runs plugin.js headlessly against real wn (jsdom + React)
dev/harness/           the harness's Buzz stand-in, wn helpers and test groups
dev/relay-up.sh        starts a local Marmot relay (strfry in Docker) for the harness
dev/strfry.conf        that relay's config
```

## Features

- An **Encrypted messages** section in the Buzz sidebar, styled like Direct
  messages: one row per chat with the other members' avatars and names, unread
  chats in bold with a dot, and pending invites marked "Invite". Its **…** menu
  has Filter (All / Unreads), Sort (Recent / A–Z), **Show untagged chats** and
  **Copy my Marmot ID**; **+** starts a new chat.
- **New encrypted chat** works like Buzz's New message: search people by name in
  "To:", or paste a key (`npub1…`, `nostr:npub1…` or 64-character hex). A Buzz
  person's key, or the Marmot ID their Buzz identity published, finds that
  person; any other Marmot ID with a published KeyPackage (for example a White
  Noise user) can be invited directly. Sending to people you already have a chat
  with in this community continues that chat, like a DM.
- **Conversations** open full width with Buzz's own message rows, Markdown,
  avatars, day dividers and composer. Invites show **Accept** / **Decline**. The
  ⓘ button in the header explains the experiment and links here.
- **Settings → Plugins → Encrypted chats** shows your Marmot ID and its status.

## Requirements

- Buzz 1.0 desktop (macOS; other platforms are untested).
- MDK's `wn` and `wnd` installed where Buzz can find them (see below).
- Network access to the Marmot relay `wss://relay.us.whitenoise.chat`.

## Install `wn` and `wnd` (build from source)

MDK doesn't publish prebuilt binaries for this yet, so build them from source.
Expect about 20 minutes and several GB of disk space during the build; you can
delete the build folder afterwards.

1. Install Rust with [rustup](https://rustup.rs). MDK pins its toolchain
   (Rust 1.97.1 at the time of writing) in `rust-toolchain.toml`; rustup installs
   it automatically when you build inside the checkout.
2. Get MDK and install the Odin compiler its Markdown crate needs, with MDK's
   own checksum-verifying script:
   ```sh
   git clone https://github.com/marmot-protocol/mdk.git
   cd mdk
   bash scripts/install-odin.sh "$HOME/.local/share/mdk-odin"
   export ODIN="$HOME/.local/share/mdk-odin/odin"
   ```
3. Build `wn` and `wnd`, using a throwaway target folder:
   ```sh
   CARGO_TARGET_DIR=/tmp/wn-build cargo build --release -p wn-cli --bins --locked
   ```
4. Copy both binaries where Buzz looks for programs (`~/.local/bin`, your login
   shell's `PATH`, or Homebrew's `bin`):
   ```sh
   mkdir -p ~/.local/bin
   cp /tmp/wn-build/release/wn /tmp/wn-build/release/wnd ~/.local/bin/
   ```
   Keep them side by side: `wn daemon start` launches the `wnd` next to it.
5. Reclaim the space: `rm -rf /tmp/wn-build` (and the `mdk` checkout if you
   like).

Check with `wn --version`. If MDK publishes a Homebrew formula
(`brew install marmot-protocol/tap/wn`), that installs both binaries too.

## Install the plugin

Install it in every Buzz profile you want to use it with.

**From GitHub, by link.** Open this link (for example with `open '…'` in a
terminal on macOS):

```
buzz://plugin-install?repository=https%3A%2F%2Fgithub.com%2Fjanuszgrze%2Fbuzz-marmot-plugin.git&ref=main&path=plugin
```

Buzz opens a preview in **Settings → Plugins → Manage plugins → Add**. Review
the access it asks for (it runs the `wn` program) and choose **Install
plugin**. The link only opens the preview; nothing is installed until you
confirm. To pin an exact version, add `&commit=<full commit hash>`.

**From a folder.** Clone this repository, then in Buzz open **Settings →
Plugins → Manage plugins → Add**, choose **Browse** under *Add from folder*,
and pick the repository's `plugin` folder (not the repository root). Use
Browse rather than drag-and-drop, so Buzz can update the plugin from that
folder later.

The **Encrypted messages** section then appears in the sidebar. The first start
takes a few seconds while the plugin starts `wnd` and creates your Marmot
account.

## How it works

**A separate Marmot identity.** Each Buzz identity gets its own Marmot account,
created automatically, with its own `wn` home folder under `~/.buzz-marmot/` and
its own `wnd` daemon. `wnd` keeps running after Buzz quits, so you keep
receiving. The Marmot private key is stored in the **macOS Keychain**
(service `buzz-marmot.<id>`), created and read by `wnd`.

**Binding.** So that others can find you, the plugin publishes, signed by your
Buzz key through Buzz's normal outbox, an addressable event naming your Marmot
key:

```json
{"kind": 30315, "tags": [["d", "marmot.chats:binding"], ["alt", "…"]],
 "content": "{\"v\":1,\"account\":\"<marmot hex>\",\"npub\":\"npub1…\"}"}
```

New chat reads the picked people's bindings to invite their Marmot keys, and
the plugin reads all bindings in the community to show message authors as Buzz
people. Kind 30315 (NIP-38 status) is used because Buzz's signer only accepts
that kind for plugin data today; Buzz shows only `d=general` statuses, so the
binding never appears as a status. The binding is a claim by the Buzz key
only; the Marmot key doesn't countersign it yet.

**Marmot relay.** All Marmot traffic (relay lists, KeyPackages, invites and
encrypted group messages) goes to `wss://relay.us.whitenoise.chat`, White
Noise's public relay (`MARMOT_RELAYS` in `src/shared/constants.js`). Your Buzz community relay
only carries the binding.

**Chats belong to a community.** There is one Marmot account across all your
Buzz communities, but each new chat is tagged with the community it was created
in, and the sidebar lists only the active community's chats. The tag is one
line in the chat's MLS group description, which is encrypted group data (members
and invitees can read it, relays can't):

```
buzz-community/v1 wss://buzz.example.com
```

Chats without that line (created by other Marmot apps such as White Noise, or
by older versions of this plugin) are untagged. **… → Show untagged chats**
lists untagged chats and chats tagged for other communities too.

## Known limitations

- **Forward re-sends as plain text.** Buzz's Forward action on an encrypted
  message posts the decrypted text to an ordinary Buzz chat, unencrypted.
- Text only: no attachments, reactions, edits, deletions, replies or mentions
  (formatting is sent as typed). Buzz's own react/edit/delete actions are off
  in encrypted chats.
- The sidebar section, its menu, the people search popup and avatars imitate
  Buzz's styling with Buzz's global CSS classes and tokens, which stock Buzz
  doesn't promise to keep; a future Buzz release may break the look.
- Up to 200 recent messages per chat; no rename, leave, archive or member
  management yet.
- One Marmot account per Buzz identity, created automatically; importing an
  existing key isn't supported.
- macOS-focused (Keychain storage); other platforms are untested.

## Development

The source lives in `src/` as plain-JS ES modules. `npm run build` bundles it
with esbuild into `plugin/plugin.js`, the one self-contained module (no
imports, exporting `inject` and `apply`) that Buzz installs. The built file is
committed so the install link works straight from the repository; edit `src/`,
never `plugin/plugin.js`. After a build, update the installed copy from
**Settings → Plugins → Marmot chats → Update** (for a folder install), then
reload the window.

```sh
npm install                              # esbuild, the only dependency
npm run build                            # src/ → plugin/plugin.js
node dev/validate.mjs                    # manifest, bundle and source checks
./dev/relay-up.sh && node dev/harness.mjs
```

`dev/validate.mjs` also rebuilds `src/` to a temporary file and fails with
"run npm run build" if `plugin/plugin.js` doesn't match it.

`src/main.js` exports `inject` and an `apply` that builds each feature in turn
on one shared `env` object (each `create*` function reads what earlier ones
added and returns its own exports):

| Folder | Contents |
| --- | --- |
| `src/shared/` | Constants (`MARMOT_RELAYS`, `PLUGIN_REPO_URL`, homes, kinds), the store, preferences, host hooks, UI primitives and styles |
| `src/marmot/` | The `wn` process runner, JSON envelopes, per-identity homes, and the session (daemon, account, feeds, chat actions) |
| `src/community/` | The `buzz-community/v1` tag and the active community |
| `src/binding/` | Publishing and looking up kind 30315 Marmot ID bindings |
| `src/people/` | npub/hex parsing, resolving people to Marmot accounts, names and avatars |
| `src/sidebar/` | The Encrypted messages section, its row icon and "…" menu |
| `src/new-chat/` | The New chat view and its To field |
| `src/conversation/` | Timeline, header (with the ⓘ popover) and conversation view |
| `src/page/` | The Encrypted chats page and its registration |
| `src/settings/` | The Marmot ID settings card |

`dev/harness.mjs` runs the test groups in `dev/harness/`: `buzz.mjs` (the Buzz
host stand-in that loads the bundle), `wn.mjs` (wn processes and CLI accounts),
`relay.mjs` (the in-memory Buzz relay), `assert.mjs` (waiting and DOM helpers),
and `sidebar.mjs`, `new-chat.mjs`, `unread.mjs`, `community.mjs` and
`conversation.mjs`.

The harness runs the real `plugin.js` with React 19 and jsdom taken from a
[buzz-app](https://github.com/block/buzz) checkout with its `node_modules`
installed (`BUZZ_APP`, default `../buzz-app` next to this repository), a mock
plugin context whose `host.spawn` runs real `wn` processes, and headless CLI
accounts as the other people in each chat. It never touches the public relay or
the Keychain: it patches its copy of the plugin to a local strfry relay on
`ws://127.0.0.1:27777` (`dev/relay-up.sh`, Docker, image `dockurr/strfry`) and
file-stored keys, with its homes under `~/.buzz-marmot-dev/`. It covers
invites, live messages, unread state, community tagging, the To field's name
and key lookups, raw Marmot ID invites, and continuing existing chats.
`--boot-only` with `VIEWER=<hex>` only checks that an identity gets its own
home, daemon and account.

To try a chat from the command line, run a second `wn` account in its own home:

```sh
mkdir -p ~/marmot-cli && cd ~/marmot-cli
R=wss://relay.us.whitenoise.chat
WN_SECRET_STORE=file wn --home . daemon start --discovery-relays $R --default-account-relays $R
sleep 3; WN_SECRET_STORE=file wn --home . --json create-identity
# invite your plugin account (Copy my Marmot ID), tagged for a community:
WN_SECRET_STORE=file wn --home . --json groups create \
  --description="buzz-community/v1 wss://buzz.example.com" "cli chat" <your-marmot-npub>
WN_SECRET_STORE=file wn --home . --json messages send --group <group_id> "hello"
```

## Contributing

Issues and pull requests are welcome. Please keep to stock Buzz plugin APIs (no
Buzz changes), edit `src/` and commit the rebuilt `plugin/plugin.js`, and run
`node dev/validate.mjs` and the harness before opening a pull request.

## Third-party software

This plugin runs MDK's `wn` and `wnd` (the
[Marmot Development Kit](https://github.com/marmot-protocol/mdk), by the
Internet Privacy Foundation), which you install separately; the plugin doesn't
bundle them. MDK is separate software under its own license (MIT, see the
[MDK repository](https://github.com/marmot-protocol/mdk/blob/master/LICENSE)).
Buzz is developed by Block in [block/buzz](https://github.com/block/buzz).

## License

[MIT](LICENSE) © 2026 januszgrze
