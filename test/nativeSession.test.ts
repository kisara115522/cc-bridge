import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverCodexSession } from "../src/native/codexDiscovery.js";
import {
  buildNativeSessionCommand,
  type NativeSessionRef
} from "../src/native/nativeSession.js";

describe("buildNativeSessionCommand", () => {
  const cwd = "/Users/example/Code/project";

  it("builds Claude new, resume, and fork commands with explicit session IDs", () => {
    expect(
      buildNativeSessionCommand({
        tool: "claude",
        action: "new",
        command: "claude",
        baseArgs: [],
        cwd,
        sessionId: "11111111-1111-4111-8111-111111111111"
      })
    ).toEqual({
      command: "claude",
      args: ["--session-id", "11111111-1111-4111-8111-111111111111"],
      cwd
    });

    expect(
      buildNativeSessionCommand({
        tool: "claude",
        action: "resume",
        command: "claude",
        baseArgs: [],
        cwd,
        sessionId: "22222222-2222-4222-8222-222222222222"
      })
    ).toEqual({
      command: "claude",
      args: ["--resume", "22222222-2222-4222-8222-222222222222"],
      cwd
    });

    expect(
      buildNativeSessionCommand({
        tool: "claude",
        action: "fork",
        command: "claude",
        baseArgs: [],
        cwd,
        sessionId: "33333333-3333-4333-8333-333333333333"
      })
    ).toEqual({
      command: "claude",
      args: ["--resume", "33333333-3333-4333-8333-333333333333", "--fork-session"],
      cwd
    });
  });

  it("builds Codex new, resume, and fork commands with cwd and no-alt-screen behavior", () => {
    expect(
      buildNativeSessionCommand({
        tool: "codex",
        action: "new",
        command: "codex",
        baseArgs: [],
        cwd
      })
    ).toEqual({
      command: "codex",
      args: ["--cd", cwd, "--no-alt-screen"],
      cwd
    });

    expect(
      buildNativeSessionCommand({
        tool: "codex",
        action: "resume",
        command: "codex",
        baseArgs: ["--no-alt-screen"],
        cwd,
        sessionId: "44444444-4444-4444-8444-444444444444"
      })
    ).toEqual({
      command: "codex",
      args: [
        "resume",
        "44444444-4444-4444-8444-444444444444",
        "--cd",
        cwd,
        "--no-alt-screen"
      ],
      cwd
    });

    expect(
      buildNativeSessionCommand({
        tool: "codex",
        action: "fork",
        command: "codex",
        baseArgs: ["--no-alt-screen"],
        cwd,
        sessionId: "55555555-5555-4555-8555-555555555555"
      })
    ).toEqual({
      command: "codex",
      args: [
        "fork",
        "55555555-5555-4555-8555-555555555555",
        "--cd",
        cwd,
        "--no-alt-screen"
      ],
      cwd
    });
  });

  it("keeps native session references independent from bridge storage", () => {
    const claudeRef: NativeSessionRef = {
      tool: "claude",
      confidence: "explicit",
      sessionId: "66666666-6666-4666-8666-666666666666"
    };
    const codexRef: NativeSessionRef = {
      tool: "codex",
      confidence: "discovered",
      sessionId: "77777777-7777-4777-8777-777777777777"
    };
    const unknownCodexRef: NativeSessionRef = {
      tool: "codex",
      confidence: "unknown"
    };

    expect(claudeRef.sessionId).toBe("66666666-6666-4666-8666-666666666666");
    expect(codexRef.confidence).toBe("discovered");
    expect(unknownCodexRef.sessionId).toBeUndefined();
  });
});

describe("discoverCodexSession", () => {
  it("finds a Codex session by JSONL session_meta payload id and matching cwd", async () => {
    const root = await mkdirTempSessionRoot();
    const sessionDir = join(root, "2026", "05", "03");
    await mkdir(sessionDir, { recursive: true });

    await writeFile(
      join(sessionDir, "rollout-other.jsonl"),
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          cwd: "/Users/example/Code/other"
        }
      })
    );
    await writeFile(
      join(sessionDir, "rollout-target.jsonl"),
      [
        JSON.stringify({ type: "turn_context", payload: { cwd: "/Users/example/Code/project" } }),
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            cwd: "/Users/example/Code/project"
          }
        })
      ].join("\n")
    );

    await expect(
      discoverCodexSession({
        sessionsRoot: root,
        cwd: "/Users/example/Code/project"
      })
    ).resolves.toEqual({
      tool: "codex",
      confidence: "discovered",
      sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    });
  });

  it("skips rollout files when their available cwd does not match", async () => {
    const root = await mkdirTempSessionRoot();
    const sessionDir = join(root, "2026", "05", "03");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "rollout-mismatch.jsonl"),
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          cwd: "/Users/example/Code/other"
        }
      })
    );

    await expect(
      discoverCodexSession({
        sessionsRoot: root,
        cwd: "/Users/example/Code/project"
      })
    ).resolves.toEqual({
      tool: "codex",
      confidence: "unknown"
    });
  });

  it("ignores payload ids that are not from session_meta records", async () => {
    const root = await mkdirTempSessionRoot();
    const sessionDir = join(root, "2026", "05", "03");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "rollout-event.jsonl"),
      JSON.stringify({
        type: "event_msg",
        payload: {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          cwd: "/Users/example/Code/project"
        }
      })
    );

    await expect(
      discoverCodexSession({
        sessionsRoot: root,
        cwd: "/Users/example/Code/project"
      })
    ).resolves.toEqual({
      tool: "codex",
      confidence: "unknown"
    });
  });
});

async function mkdirTempSessionRoot(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");

  return mkdtemp(join(tmpdir(), "cc-bridge-codex-sessions-"));
}
