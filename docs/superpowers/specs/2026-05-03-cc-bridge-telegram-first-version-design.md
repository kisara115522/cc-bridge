# cc-bridge Telegram First Version Design

**Date:** 2026-05-03

**Goal:** Build a production-usable local bridge that lets an authorized Telegram user remotely operate the user's local Codex CLI and Claude Code CLI, with rich Telegram controls, durable bridge-level session tracking, and clean channel interfaces for future WeChat support.

**Status:** Design spec, ready for implementation planning after review.

---

## 1. Product Scope

cc-bridge is a local service running on the user's computer. It connects Telegram Bot updates to local interactive Codex / Claude Code processes through PTY sessions, then streams output and interactive controls back to Telegram.

The first version is not a reduced text-only MVP. It must be usable as the user's daily remote control path for common coding-agent work:

- Start, resume, stop, and switch Codex / Claude Code sessions from Telegram.
- Send normal prompts as chat messages.
- Receive streamed CLI output with throttling and Telegram-safe chunking.
- Control terminal-style prompts through inline buttons such as arrows, Enter, Esc, Ctrl-C, Tab, and Yes / No confirmation buttons.
- Keep bridge state across process restarts and recover native Codex / Claude Code sessions when possible.
- Enforce strict user authorization and working-directory allowlists.
- Keep the core channel-agnostic so WeChat can be added later as a new adapter.

Out of scope for the first version:

- WeChat adapter implementation.
- Multi-user SaaS hosting.
- Browser-based dashboard.
- Reimplementing Codex or Claude Code protocols.
- Replaying full model conversation history from cc-bridge storage. Native tools own their own conversation memory.

---

## 2. Architecture

```text
Telegram Bot API
  -> TelegramChannelAdapter
  -> AuthGuard
  -> CommandRouter
  -> BridgeSessionManager
  -> LocalToolRunner
  -> PTY
  -> codex / claude

PTY output
  -> TerminalScreenModel
  -> InteractionRenderer
  -> TelegramChannelAdapter
  -> Telegram messages / edited messages / inline keyboards
```

The system has four stable boundaries:

1. **Channel boundary:** Telegram-specific update parsing and Telegram response APIs stay inside the Telegram adapter.
2. **Session boundary:** cc-bridge owns social identity, active tool selection, PTY lifecycle, and UI interaction state.
3. **Native tool boundary:** Codex / Claude Code own model conversation history, tool execution semantics, permissions, and their native resume mechanisms.
4. **Terminal boundary:** The runner treats Codex / Claude Code as interactive terminal applications, using PTY input/output rather than private internal APIs.

---

## 3. Core Modules

### 3.1 Channel Adapter

The channel interface must be implemented before Telegram-specific logic grows:

```ts
export interface ChannelAdapter {
  readonly name: ChannelName;
  readonly capabilities: ChannelCapabilities;
  start(handlers: ChannelHandlers): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: ChannelTarget, message: OutboundMessage): Promise<SentMessageRef>;
  editMessage(ref: SentMessageRef, message: OutboundMessage): Promise<void>;
  answerInteraction(interaction: ChannelInteraction, response: InteractionAnswer): Promise<void>;
  downloadAttachment(attachment: ChannelAttachment): Promise<DownloadedAttachment>;
}
```

`ChannelCapabilities` must describe whether the channel supports:

- Inline buttons.
- Message editing.
- File download.
- Typing indicator.
- Ephemeral callback acknowledgment.
- Alert-style callback acknowledgment.

Telegram implements all of these except true keyboard event capture. Keyboard behavior is simulated with inline buttons and callback queries.

Future WeChat support must not require changes to session manager or runner code. If a future WeChat adapter has weaker capabilities, the renderer degrades to text commands such as `/key up` and `/confirm yes`.

### 3.2 Auth Guard

Authorization is required before any command reaches the session manager.

Rules:

- `TELEGRAM_ALLOWED_USER_IDS` is required by default.
- Empty allowlist is rejected unless `CC_BRIDGE_ALLOW_ALL_USERS=true`.
- Group chat use requires `TELEGRAM_ALLOWED_CHAT_IDS`.
- Unauthorized messages receive a short denial response and are recorded in audit logs.
- The bot must never echo tokens, environment variables, or full local config.

### 3.3 Command Router

The router handles bridge commands before forwarding normal text to the active PTY.

Required commands:

```text
/start
/help
/doctor
/new codex [cwd]
/new claude [cwd]
/sessions
/switch <bridge-session-id>
/resume <bridge-session-id>
/fork <bridge-session-id>
/stop
/status
/keyboard
/raw <text>
/send <text>
/cwd
/cwd <allowed-path-or-alias>
/files
```

Command behavior:

- A normal non-command Telegram message is sent to the active session followed by Enter.
- `/raw <text>` writes text without Enter.
- `/send <text>` writes text plus Enter.
- `/stop` sends Ctrl-C to the active PTY first; if the process does not settle within the configured timeout, it terminates the PTY process.
- `/keyboard` shows an inline keyboard attached to the active session.
- `/doctor` checks config, allowed user, Telegram connectivity, local CLI availability, and state directory writability.

### 3.4 Bridge Session Manager

cc-bridge owns `BridgeSession`. A bridge session is not the same thing as a Codex or Claude native session.

```ts
export interface BridgeSession {
  id: string;
  channel: "telegram";
  channelChatId: string;
  channelUserId: string;
  tool: "codex" | "claude";
  cwd: string;
  status: "starting" | "running" | "awaiting_input" | "idle" | "stopped" | "exited" | "errored";
  activePtyPid: number | null;
  native: NativeSessionRef | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  title: string | null;
}
```

```ts
export interface NativeSessionRef {
  tool: "codex" | "claude";
  id: string | null;
  resumeCommand: string[];
  discoveredAt: string | null;
  confidence: "explicit" | "discovered" | "last-resort" | "unknown";
}
```

Session rules:

- Each Telegram chat has one active bridge session.
- A user can keep multiple bridge sessions and switch between them.
- One bridge session maps to at most one active PTY process at a time.
- If the bridge process restarts, it does not assume old PTY processes are controllable. It marks them as detached or exited, then offers native resume.
- Bridge storage records session metadata, not full native model transcript.

### 3.5 Native Session Strategy

The first version uses a hybrid strategy:

```text
Telegram identity and PTY lifecycle -> cc-bridge BridgeSession
Model conversation memory            -> native Codex / Claude Code session
Inline keyboard state                -> cc-bridge InteractionSession
```

Claude Code:

- New sessions use a generated UUID through `claude --session-id <uuid>`.
- Resume uses `claude --resume <uuid>`.
- Continue-last is not used for normal bridge recovery because it can select the wrong conversation.
- Fork uses `claude --resume <uuid> --fork-session`.

Codex:

- Current Codex CLI supports `codex resume [SESSION_ID]` and `codex fork [SESSION_ID]`.
- Current Codex CLI does not expose a new-session `--session-id` flag in `codex --help`.
- cc-bridge starts new Codex sessions with normal `codex --cd <cwd> --no-alt-screen`.
- A `CodexSessionDiscoverer` watches `~/.codex/sessions/**/rollout-*.jsonl` for a new session whose start time and cwd match the bridge session.
- Once discovered, cc-bridge stores the Codex session UUID and uses `codex resume <uuid>` or `codex fork <uuid>`.
- If discovery fails, the live PTY still works, but restart recovery is marked `confidence: "unknown"` and `/resume` explains that native Codex session discovery failed.

This difference must be visible in `/status`, because Claude recovery can be explicit while Codex recovery is discovered.

### 3.6 Local Tool Runner

The runner owns PTY creation and lifecycle.

Runner responsibilities:

- Spawn Codex / Claude Code with a pseudo-terminal.
- Preserve terminal-like behavior for interactive CLIs.
- Normalize environment variables so background service startup resembles the user's normal shell enough to find `codex`, `claude`, Node, Git, and language runtimes.
- Track process status, exit code, and signal.
- Send terminal control sequences for Telegram button actions.
- Emit structured events for output chunks, screen changes, process exit, and errors.

Default launch commands:

```text
codex --cd <cwd> --no-alt-screen
codex resume <native-id> --cd <cwd> --no-alt-screen
codex fork <native-id> --cd <cwd> --no-alt-screen

claude --session-id <uuid> -n <bridge-title>
claude --resume <uuid>
claude --resume <uuid> --fork-session
```

Config can append safe extra arguments, for example model/profile flags. Dangerous defaults such as blanket bypass permissions must not be enabled automatically.

### 3.7 Terminal Screen Model

The runner must not treat all PTY output as plain append-only text. It needs a terminal model:

- Keep recent scrollback for normal output.
- Keep a current screen buffer for TUI-like prompts.
- Parse ANSI control codes.
- Detect whether the output is append-like or screen-like.
- Strip ANSI safely for Telegram text.
- Preserve enough screen structure for selection prompts.

Implementation should use a maintained xterm-compatible parser or terminal buffer library rather than ad hoc regex parsing for all terminal behavior. Regex detection is allowed only as a higher-level hint for common prompts.

### 3.8 Interaction Renderer

The renderer converts runner events into Telegram messages and inline keyboards.

Required render modes:

1. **Stream mode:** Normal output is batched and sent as Telegram messages.
2. **Pinned screen mode:** A single Telegram message is edited to represent the current screen or current prompt.
3. **Keyboard mode:** The user can manually open a control pad.
4. **Confirmation mode:** Yes / No / Cancel buttons appear when the screen indicates a confirmation prompt.

Required Telegram controls:

```text
Up, Down, Left, Right
Enter
Esc
Tab
Backspace
Ctrl-C
Ctrl-D
Yes
No
Cancel
Refresh
Hide Keyboard
```

Control mapping:

```text
up        -> "\x1b[A"
down      -> "\x1b[B"
right     -> "\x1b[C"
left      -> "\x1b[D"
enter     -> "\r"
esc       -> "\x1b"
tab       -> "\t"
backspace -> "\x7f"
ctrl-c    -> "\x03"
ctrl-d    -> "\x04"
yes       -> "y\r"
no        -> "n\r"
cancel    -> "\x03"
```

Telegram callback data must be compact and opaque. It should contain an interaction ID, not raw commands or local paths.

### 3.9 Attachments

Telegram documents, images, and voice messages are not ignored.

First-version behavior:

- Documents and images are downloaded into the bridge state directory under `uploads/<bridge-session-id>/`.
- The bridge records original Telegram metadata and local file path.
- The active PTY receives a short message containing the local file path and user caption.
- For Codex image support, a new session can include initial `--image <file>` only when the image is attached to `/new codex`.
- For existing sessions, attachments are introduced as local file paths because interactive CLI image attachment support differs by tool and must not be guessed.
- Voice messages are downloaded but not transcribed in the first version; the bot replies with the saved path.

---

## 4. Storage

Use SQLite for durable local state.

State directory default:

```text
~/.cc-bridge/
```

Database default:

```text
~/.cc-bridge/cc-bridge.sqlite
```

Required tables:

- `bridge_sessions`
- `native_sessions`
- `channel_messages`
- `interaction_messages`
- `runner_events`
- `uploads`
- `audit_logs`

Retention:

- Runner output is stored as bounded event logs for debugging, not as permanent full transcripts.
- Large uploads stay on disk until `/files cleanup` or retention expiry.
- Audit logs keep authorization failures, command invocations, session starts/stops, and resume/fork operations.

---

## 5. Configuration

Configuration sources, highest priority first:

1. CLI flags.
2. Environment variables.
3. Config file at `~/.cc-bridge/config.yaml`.
4. Built-in defaults.

Required config:

```yaml
telegram:
  botToken: "${TELEGRAM_BOT_TOKEN}"
  allowedUserIds: ["123456789"]
  allowedChatIds: []
  polling: true

security:
  allowAllUsers: false
  allowedCwds:
    - "/Users/xxx/Code/workSpace"
    - "/Users/xxx/Code/appWorkSpace"
  defaultCwd: "/Users/xxx/Code/workSpace"

tools:
  codex:
    command: "/opt/homebrew/bin/codex"
    args: ["--no-alt-screen"]
  claude:
    command: "/opt/homebrew/bin/claude"
    args: []

runtime:
  stateDir: "~/.cc-bridge"
  idleTimeoutMinutes: 120
  outputFlushMs: 800
  maxTelegramMessageChars: 3500
  ptyCols: 100
  ptyRows: 30
```

The implementation must validate config at startup with clear errors.

---

## 6. Telegram Behavior

Telegram runs in long polling mode for the first version. Webhook mode is a future deployment option.

Required Telegram features:

- `/start` shows tool status and current active session.
- `/help` shows command list.
- Inline keyboard callbacks are acknowledged with `answerCallbackQuery`.
- Long outputs are chunked below Telegram limits.
- Frequently changing screen output edits a pinned message instead of sending a new message every time.
- Bot sends typing/chat action during active tool execution when supported.
- Telegram file IDs are resolved and downloaded through the Bot API.

When a callback refers to an expired interaction, the bot answers with a short expired-state message and offers `/keyboard` or `/status`.

---

## 7. Security Model

Threat model:

- Telegram account compromise.
- Bot token leak.
- Accidental group chat exposure.
- Remote command execution through Codex / Claude Code tools.
- Sensitive local paths or environment values leaking into logs.

Controls:

- Explicit Telegram user allowlist by default.
- Optional chat allowlist for groups.
- Working directory allowlist.
- No raw shell endpoint in cc-bridge.
- No unauthenticated HTTP server.
- Local config and tokens are never printed in full.
- Upload paths stay inside state directory.
- Callback data never contains local filesystem paths.
- Session audit logs record who started/stopped/resumed sessions.

cc-bridge is still a remote-control tool for local coding agents. The README and `/doctor` output must state that authorized Telegram users can cause local tool execution through Codex / Claude Code.

---

## 8. Error Handling

Required user-visible errors:

- Unauthorized user.
- Missing Telegram token.
- Telegram API connection failure.
- `codex` command missing or not executable.
- `claude` command missing or not executable.
- Requested cwd outside allowlist.
- No active session.
- PTY exited.
- Native session resume unavailable.
- Interaction expired.

Error style:

- Short message to Telegram.
- Detailed structured log locally.
- No stack traces sent to Telegram by default.

---

## 9. CLI Surface

The local service provides its own CLI:

```text
cc-bridge start
cc-bridge doctor
cc-bridge sessions list
cc-bridge sessions show <id>
cc-bridge sessions stop <id>
cc-bridge config print --redacted
```

`doctor` checks:

- Config file parse result.
- Telegram token presence.
- Telegram `getMe`.
- Allowed users/chats.
- `codex --version`.
- `claude --version`.
- State directory read/write.
- SQLite open/migrate.
- PTY spawn smoke test.

---

## 10. Testing Strategy

Unit tests:

- Config parsing and redaction.
- Auth guard.
- Command parsing.
- Session manager state transitions.
- Native session command generation.
- Telegram callback data encoding/decoding.
- Terminal key mapping.
- Output chunking.
- Interaction expiry.

Integration tests:

- Fake Telegram adapter plus fake runner for full command flow.
- Fake PTY runner for output batching and screen editing.
- SQLite migration and persistence.
- Restart recovery from stored bridge sessions.

Manual smoke tests:

1. Start `cc-bridge start`.
2. Send `/doctor` from authorized Telegram account.
3. Send `/new codex <allowed cwd>`.
4. Ask Codex to run a harmless command.
5. Open `/keyboard`, press Ctrl-C, verify interruption.
6. Send `/new claude <allowed cwd>`.
7. Ask Claude Code a harmless project question.
8. Restart cc-bridge.
9. Use `/sessions`, `/resume <id>`, and continue the previous session.
10. Send a message from an unauthorized Telegram account and verify denial.

---

## 11. Acceptance Criteria

The first version is complete when:

- A clean checkout can install dependencies and run tests.
- `cc-bridge doctor` passes on the user's machine after config is provided.
- Telegram `/new codex` starts a real local Codex interactive session.
- Telegram `/new claude` starts a real local Claude Code interactive session.
- Normal messages stream responses back to Telegram.
- Inline keyboard controls can send arrows, Enter, Esc, Ctrl-C, and Yes / No.
- `/sessions`, `/switch`, `/resume`, `/fork`, `/stop`, and `/status` work.
- Unauthorized Telegram users cannot interact with local tools.
- Bridge restart does not lose stored bridge session metadata.
- Claude native resume uses explicit session IDs.
- Codex native resume uses discovered session IDs when available and reports confidence.
- The channel interface is covered by tests and does not mention Telegram-specific types.
- The README explains setup, security implications, and first-run verification.

---

## 12. Implementation Commit Granularity

Implementation should be committed in small, reviewable steps:

1. Project scaffold.
2. Config schema.
3. Logger.
4. SQLite migrations.
5. Core channel types.
6. Auth guard.
7. Command parser.
8. Session manager.
9. Native session command builders.
10. PTY runner.
11. Terminal screen model.
12. Interaction renderer.
13. Telegram adapter.
14. Attachment handling.
15. CLI commands.
16. Doctor checks.
17. End-to-end fake adapter tests.
18. README setup guide.

Each commit should compile and keep tests passing unless it is an intentional scaffold-only commit with no executable surface yet.

---

## 13. Open Design Decisions Resolved

**First channel:** Telegram only.

**Future channels:** Keep adapter interface and capability model now; do not implement WeChat yet.

**Session ownership:** cc-bridge owns bridge/session routing state; Codex and Claude Code own model conversation state.

**Terminal interaction:** PTY is the default because it preserves interactive CLI behavior. Telegram inline keyboards simulate terminal keys.

**Native resume:** Claude uses explicit `--session-id`; Codex uses session discovery because current CLI help does not expose explicit new-session IDs.

**Storage:** SQLite in `~/.cc-bridge`.

**Security default:** Explicit allowlist required.
