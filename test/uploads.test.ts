import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createUploadStore } from "../src/uploads/uploadStore.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("UploadStore", () => {
  it("stores uploads under the session directory with sanitized names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-bridge-uploads-"));
    tempDirs.push(dir);
    const store = createUploadStore({ stateDir: dir });

    const saved = await store.save({
      sessionId: "bridge_1",
      attachmentId: "file-1",
      filename: "../notes.txt",
      mimeType: "text/plain",
      data: new TextEncoder().encode("hello")
    });

    expect(saved.localPath).toBe(join(dir, "uploads", "bridge_1", "notes.txt"));
    expect(saved.sizeBytes).toBe(5);
  });
});
