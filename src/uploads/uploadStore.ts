import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { DownloadedAttachment } from "../channel/types.js";

export interface UploadStoreOptions {
  readonly stateDir: string;
}

export interface SaveUploadInput extends DownloadedAttachment {
  readonly sessionId: string;
}

export interface SavedUpload {
  readonly sessionId: string;
  readonly attachmentId: string;
  readonly filename: string;
  readonly mimeType?: string;
  readonly localPath: string;
  readonly sizeBytes: number;
}

export function createUploadStore(options: UploadStoreOptions) {
  return {
    async save(input: SaveUploadInput): Promise<SavedUpload> {
      const filename = sanitizeFilename(input.filename ?? input.attachmentId);
      const dir = join(options.stateDir, "uploads", input.sessionId);
      await mkdir(dir, { recursive: true });
      const localPath = join(dir, filename);
      await writeFile(localPath, input.data);
      return {
        sessionId: input.sessionId,
        attachmentId: input.attachmentId,
        filename,
        mimeType: input.mimeType,
        localPath,
        sizeBytes: input.data.byteLength
      };
    }
  };
}

function sanitizeFilename(filename: string): string {
  const cleaned = basename(filename).replace(/[^\w.-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "upload";
}
