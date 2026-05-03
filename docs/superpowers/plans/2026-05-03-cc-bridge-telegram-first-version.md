# cc-bridge Telegram First Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-usable Telegram bridge for remotely operating local Codex CLI and Claude Code CLI sessions.

**Architecture:** The bridge is a TypeScript Node.js service with channel-agnostic core interfaces, a Telegram adapter, SQLite-backed bridge session state, and PTY-based local tool runners. cc-bridge owns social routing, safety, PTY lifecycle, and interaction UI state; Codex and Claude Code own their native conversation history.

**Tech Stack:** Node.js 22, TypeScript, Vitest, Commander, Zod, YAML, node-telegram-bot-api, node-pty, better-sqlite3.

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `test/smoke.test.ts`

- [ ] Create a strict TypeScript CLI package with `build`, `test`, `typecheck`, and `start` scripts.
- [ ] Add one smoke test that imports the CLI entry module.
- [ ] Run `npm install`.
- [ ] Run `npm test` and `npm run typecheck`.
- [ ] Commit as `chore: scaffold typescript cli`.

## Task 2: Configuration And Redaction

**Files:**
- Create: `src/config/config.ts`
- Create: `src/config/redact.ts`
- Create: `test/config.test.ts`

- [ ] Write tests for env/config-file precedence, required Telegram token validation, allowlist validation, path expansion, and redacted output.
- [ ] Implement Zod-backed config parsing from defaults, YAML file, environment variables, and CLI overrides.
- [ ] Ensure empty Telegram user allowlist is rejected unless `security.allowAllUsers` is true.
- [ ] Run focused config tests, full tests, and typecheck.
- [ ] Commit as `feat: add bridge configuration loader`.

## Task 3: Channel Contracts And Auth Guard

**Files:**
- Create: `src/channel/types.ts`
- Create: `src/auth/authGuard.ts`
- Create: `test/auth.test.ts`

- [ ] Write tests for authorized users, unauthorized users, group chat allowlist behavior, and `allowAllUsers`.
- [ ] Implement channel-neutral message, target, attachment, interaction, and outbound message types.
- [ ] Implement `AuthGuard.authorizeInbound`.
- [ ] Run focused auth tests, full tests, and typecheck.
- [ ] Commit as `feat: add channel contracts and auth guard`.

## Task 4: Command Router

**Files:**
- Create: `src/commands/parser.ts`
- Create: `src/commands/help.ts`
- Create: `test/commands.test.ts`

- [ ] Write tests for every command in the design spec and for normal text forwarding.
- [ ] Implement deterministic parsing for `/new`, `/resume`, `/fork`, `/switch`, `/stop`, `/status`, `/keyboard`, `/raw`, `/send`, `/cwd`, `/files`, `/doctor`, `/help`, and `/start`.
- [ ] Run focused command tests, full tests, and typecheck.
- [ ] Commit as `feat: add command parser`.

## Task 5: SQLite Storage

**Files:**
- Create: `src/storage/database.ts`
- Create: `src/storage/migrations.ts`
- Create: `src/storage/repositories.ts`
- Create: `test/storage.test.ts`

- [ ] Write tests for schema migration, bridge session persistence, active-session lookup, runner event insertion, interaction message insertion, upload records, and audit logs.
- [ ] Implement SQLite open/migrate helpers and repository methods.
- [ ] Run focused storage tests, full tests, and typecheck.
- [ ] Commit as `feat: add sqlite state storage`.

## Task 6: Session Manager And Native Session Commands

**Files:**
- Create: `src/session/sessionManager.ts`
- Create: `src/native/nativeSession.ts`
- Create: `src/native/codexDiscovery.ts`
- Create: `test/session.test.ts`
- Create: `test/nativeSession.test.ts`

- [ ] Write tests for new Claude sessions with explicit UUIDs, new Codex sessions with discovered-native confidence, resume/fork command generation, active session switching, restart recovery markings, and status formatting.
- [ ] Implement bridge session lifecycle and native session command builders.
- [ ] Implement Codex session discovery from local `~/.codex/sessions` JSONL files.
- [ ] Run focused session/native tests, full tests, and typecheck.
- [ ] Commit as `feat: add bridge session lifecycle`.

## Task 7: PTY Runner And Terminal Utilities

**Files:**
- Create: `src/runner/keys.ts`
- Create: `src/runner/ptyRunner.ts`
- Create: `src/terminal/chunker.ts`
- Create: `src/terminal/screen.ts`
- Create: `test/runnerKeys.test.ts`
- Create: `test/chunker.test.ts`

- [ ] Write tests for key mappings, output chunking, ANSI stripping, and runner event shape.
- [ ] Implement PTY spawn/write/stop lifecycle behind a `ToolRunner` interface.
- [ ] Keep PTY behavior replaceable by a fake runner for tests.
- [ ] Run focused runner/terminal tests, full tests, and typecheck.
- [ ] Commit as `feat: add pty runner foundation`.

## Task 8: Interaction Renderer

**Files:**
- Create: `src/interaction/callbackData.ts`
- Create: `src/interaction/keyboards.ts`
- Create: `src/interaction/renderer.ts`
- Create: `test/interaction.test.ts`

- [ ] Write tests for opaque callback encoding, expired callback handling, control-pad rendering, confirmation rendering, and callback-to-PTY input mapping.
- [ ] Implement Telegram-safe inline keyboard models through channel-neutral buttons.
- [ ] Run focused interaction tests, full tests, and typecheck.
- [ ] Commit as `feat: add interactive telegram controls`.

## Task 9: Telegram Adapter

**Files:**
- Create: `src/telegram/telegramAdapter.ts`
- Create: `src/telegram/telegramFormat.ts`
- Create: `test/telegramFormat.test.ts`

- [ ] Write tests for Telegram message formatting, chunking boundaries, callback conversion, and attachment metadata conversion.
- [ ] Implement long-polling Telegram adapter with send, edit, callback acknowledgment, chat actions, and file download.
- [ ] Keep raw Telegram types inside `src/telegram`.
- [ ] Run focused Telegram tests, full tests, and typecheck.
- [ ] Commit as `feat: add telegram channel adapter`.

## Task 10: Application Orchestrator And CLI

**Files:**
- Create: `src/app/bridgeApp.ts`
- Create: `src/cli.ts`
- Create: `src/doctor.ts`
- Modify: `src/index.ts`
- Create: `test/bridgeApp.test.ts`
- Create: `test/doctor.test.ts`

- [ ] Write tests for fake adapter plus fake runner flows: `/new`, normal prompt, `/keyboard`, callback keypress, `/stop`, `/status`, and unauthorized messages.
- [ ] Implement app orchestration connecting auth, command parsing, sessions, runner, renderer, storage, and Telegram adapter.
- [ ] Implement `cc-bridge start`, `doctor`, `sessions list`, `sessions show`, `sessions stop`, and `config print --redacted`.
- [ ] Run focused app tests, full tests, and typecheck.
- [ ] Commit as `feat: wire bridge application`.

## Task 11: Attachments And README

**Files:**
- Create: `src/uploads/uploadStore.ts`
- Create: `test/uploads.test.ts`
- Create: `.env.example`
- Create: `README.md`

- [ ] Write tests for upload path confinement and metadata persistence.
- [ ] Implement upload storage under the configured state directory.
- [ ] Document setup, Telegram BotFather steps, security model, commands, session behavior, and smoke verification.
- [ ] Run focused upload tests, full tests, and typecheck.
- [ ] Commit as `docs: add setup and upload handling`.

## Task 12: Final Verification

**Files:**
- Modify only files required by verification fixes.

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `node dist/index.js doctor --config-print-only` or the closest safe doctor command without requiring a real Telegram token.
- [ ] Push all commits to `origin/main`.

