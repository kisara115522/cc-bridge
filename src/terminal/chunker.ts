import stripAnsi from "strip-ansi";

export interface ChunkTerminalOutputOptions {
  maxChars: number;
}

const defaultMaxChars = 3900;

export function chunkTerminalOutput(output: string, options: Partial<ChunkTerminalOutputOptions> = {}): string[] {
  const maxChars = options.maxChars ?? defaultMaxChars;
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new Error("maxChars must be a positive integer");
  }

  const clean = stripAnsi(output);
  if (clean.length === 0) {
    return [];
  }

  const fencedChunks = chunkFencedCodeBlock(clean, maxChars);
  if (fencedChunks !== undefined) {
    return fencedChunks;
  }

  return chunkPlainText(clean, maxChars);
}

function chunkPlainText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    const splitAt = findReadableSplit(remaining, maxChars);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function findReadableSplit(text: string, maxChars: number): number {
  const window = text.slice(0, maxChars + 1);
  const newlineIndex = window.lastIndexOf("\n", maxChars);
  if (newlineIndex > 0) {
    return newlineIndex;
  }

  const spaceIndex = window.lastIndexOf(" ", maxChars);
  if (spaceIndex > 0) {
    return spaceIndex;
  }

  return maxChars;
}

function chunkFencedCodeBlock(text: string, maxChars: number): string[] | undefined {
  const lines = text.split("\n");
  const openingFence = lines[0];
  const closingFence = lines.at(-1);

  if (openingFence === undefined || closingFence === undefined) {
    return undefined;
  }

  if (!openingFence.startsWith("```") || closingFence !== "```" || lines.length < 2) {
    return undefined;
  }

  const contentLines = lines.slice(1, -1);
  const wrapperOverhead = openingFence.length + closingFence.length + 2;
  if (wrapperOverhead >= maxChars) {
    return chunkPlainText(text, maxChars);
  }

  const chunks: string[] = [];
  let currentLines: string[] = [];

  for (const line of contentLines) {
    const candidateLines = [...currentLines, line];
    if (renderFenceChunk(openingFence, candidateLines).length <= maxChars) {
      currentLines = candidateLines;
      continue;
    }

    if (currentLines.length > 0) {
      chunks.push(renderFenceChunk(openingFence, currentLines));
      currentLines = [];
    }

    if (renderFenceChunk(openingFence, [line]).length <= maxChars) {
      currentLines = [line];
      continue;
    }

    chunks.push(...chunkLongCodeLine(openingFence, line, maxChars));
  }

  if (currentLines.length > 0 || chunks.length === 0) {
    chunks.push(renderFenceChunk(openingFence, currentLines));
  }

  return chunks;
}

function renderFenceChunk(openingFence: string, lines: string[]): string {
  return [openingFence, ...lines, "```"].join("\n");
}

function chunkLongCodeLine(openingFence: string, line: string, maxChars: number): string[] {
  const bodyLimit = maxChars - openingFence.length - "```".length - 2;
  return chunkPlainText(line, bodyLimit).map((part) => renderFenceChunk(openingFence, [part]));
}
