# cc-bridge

cc-bridge lets an authorized Telegram account remotely operate the local `codex` and `claude` CLIs on this Mac.

The first channel is Telegram. The core is channel-neutral so WeChat or other channels can be added later without rewriting session or runner logic.

## What Works

- Start local Codex or Claude Code sessions from Telegram.
- Send normal Telegram messages into the active PTY session.
- Use inline keyboard controls for arrows, Enter, Esc, Tab, Backspace, Ctrl-C, Ctrl-D, Yes, No, and Cancel.
- Persist bridge session metadata in SQLite under `~/.cc-bridge`.
- Track native session strategy separately: Claude uses explicit `--session-id`; Codex is resumed by discovered native session IDs when available.
- Enforce Telegram user allowlists and working-directory allowlists by default.

## Install

```bash
npm install
npm run build
```

## Configure

Create a Telegram bot with BotFather, then copy `.env.example` or create `~/.cc-bridge/config.yaml`.

Environment variables are enough for a first run:

```bash
export TELEGRAM_BOT_TOKEN="123456:replace-me"
export TELEGRAM_ALLOWED_USER_IDS="123456789"
export CC_BRIDGE_ALLOWED_CWDS="/Users/xxx/Code/workSpace,/Users/xxx/Code/appWorkSpace"
export CC_BRIDGE_DEFAULT_CWD="/Users/xxx/Code/workSpace"
```

`TELEGRAM_ALLOWED_USER_IDS` is required unless `CC_BRIDGE_ALLOW_ALL_USERS=true`. Do not use allow-all on a real bot.

## Run

```bash
npm run build
node dist/src/index.js doctor --skip-telegram-network
node dist/src/index.js start
```

If Telegram is blocked on your network, set an HTTP proxy before running `doctor` or `start`:

```bash
export HTTPS_PROXY=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897
node dist/src/index.js doctor
node dist/src/index.js start
```

`ping` does not use HTTP proxies, so use `curl -x http://127.0.0.1:7897 https://api.telegram.org` to test the proxy path.

If `doctor` reports `pty` as `posix_spawnp failed.`, rebuild the native PTY module and restart the bridge:

```bash
npm rebuild node-pty --build-from-source
npm run build
node dist/src/index.js doctor
node dist/src/index.js start
```

## Telegram Commands

```text
/start
/help
/doctor
/new codex [cwd]
/new claude [cwd]
/sessions
/switch <id>
/resume <id>
/fork <id>
/stop
/status
/keyboard
/raw <text>
/send <text>
/cwd
/cwd <value>
/files
```

Normal text is forwarded to the active session with Enter.

## Security Model

cc-bridge is a remote-control tool. An authorized Telegram user can cause local Codex or Claude Code to run tools in allowed workspaces.

The default protections are:

- Telegram user allowlist.
- Optional group chat allowlist.
- Working-directory allowlist.
- No raw shell endpoint in cc-bridge.
- Callback data never contains local paths.
- Config redaction in doctor output.

## Development

```bash
npm test
npm run typecheck
npm run build
```

The implementation plan lives at `docs/superpowers/plans/2026-05-03-cc-bridge-telegram-first-version.md`.
