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

  const clean = cleanTuiOutput(stripAnsi(output));
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

// Box-drawing and TUI border characters
const BOX_CHARS = /[─-╿▀-▟▔▌▐▄▀]/;

// Spinner/progress indicator characters
const SPINNER_CHARS = /[✻✽✶✳✢·]/g;

// Full-line TUI patterns to remove
const TUI_LINE_PATTERNS = [
  // Box-drawing border lines (mostly box chars and whitespace)
  /^[─-╿▀-▟▔▌▐▄▀\s]+$/,
  // Status bar: user@host ... | model ... HH:MM (with or without spaces)
  /\S+@\S+\s+.*\|.*\d{2}:\d{2}/,
  // Token count: "0tokens", "↓ 1 tokens", "500tokens" (may be appended to other text)
  /[\d↓\s]*tokens?$/i,
  // Keyboard shortcut hints: "⏵⏵ don't ask on (shift+tab to cycle)"
  /⏵⏵/,
  // Thinking/processing status lines
  /thinking with \w+ effort/i,
  /Tomfoolering/i,
  // Claude Code header/footer borders
  /^[╭╰]───/,
  // Lines starting with │ (TUI box content lines)
  /^│/,
  // Status line with spinner and timing
  /…\s*\(\d+s\s*·/,
];

export function cleanTuiOutput(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines (will be handled by consecutive blank line compression)
    if (trimmed.length === 0) {
      cleaned.push("");
      continue;
    }

    // Skip lines matching full-line TUI patterns
    if (TUI_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      continue;
    }

    // Skip lines that are only box-drawing chars
    if (BOX_CHARS.test(trimmed) && trimmed.replace(/[─-╿▀-▟▔▌▐▄▀\s│╭╮╰╯]/g, "").length === 0) {
      continue;
    }

    // Skip lines that are only spinner characters
    if (trimmed.replace(SPINNER_CHARS, "").trim().length === 0) {
      continue;
    }

    // Remove spinner characters from remaining lines
    let cleanedLine = trimmed.replace(SPINNER_CHARS, "").trim();

    // Skip if line became empty after spinner removal
    if (cleanedLine.length === 0) {
      continue;
    }

    // Remove box-drawing characters from the line
    cleanedLine = cleanedLine.replace(/[─-╿▀-▟▔▌▐▄▀│╭╮╰╯]/g, "").trim();

    // Skip if line became empty after box removal
    if (cleanedLine.length === 0) {
      continue;
    }

    cleaned.push(cleanedLine);
  }

  // Compress consecutive blank lines to a single blank line
  const compressed: string[] = [];
  let lastWasBlank = false;
  for (const line of cleaned) {
    if (line.length === 0) {
      if (!lastWasBlank) {
        compressed.push(line);
      }
      lastWasBlank = true;
    } else {
      compressed.push(line);
      lastWasBlank = false;
    }
  }

  // Remove leading/trailing blank lines
  while (compressed.length > 0 && compressed[0].length === 0) {
    compressed.shift();
  }
  while (compressed.length > 0 && compressed[compressed.length - 1].length === 0) {
    compressed.pop();
  }

  return compressed.join("\n");
}
