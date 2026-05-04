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
const BOX_CHARS = /[─-╿▀-▟▔▌▐▄▀⎿⏺◉❯]/;

// Spinner/progress indicator characters
const SPINNER_CHARS = /[✻✽✶✳✢·]/g;

// Full-line TUI patterns to remove
const TUI_LINE_PATTERNS = [
  // Box-drawing border lines (mostly box chars and whitespace)
  /^[─-╿▀-▟▔▌▐▄▀⎿⏺◉❯\s]+$/,
  // Status bar: user@host ... | model ... HH:MM (with or without spaces)
  /\S+@\S+\s+.*\|.*\d{2}:\d{2}/,
  // Token count lines: "0tokens", "↓ 1 tokens", "500tokens", "44.3k out:133"
  /[\d↓.\s]*tokens?$/i,
  /in:\d[\d,.k]*\s+out:\d[\d,.k]*/,
  // Cost display: "$0.23", "$1.05"
  /\$[\d.]+/,
  // Keyboard shortcut hints
  /⏵⏵/,
  /shift\+tab/,
  /ctrl\+o/,
  // Thinking/processing status lines
  /thinking with \w+ effort/i,
  /Tomfoolering/i,
  // Claude Code header/footer borders
  /^[╭╰]───/,
  // Lines starting with │ (TUI box content lines)
  /^│/,
  // Status line with spinner and timing
  /…\s*\(\d+s\s*·/,
  // Duration/status lines: "Worked for 6s", "Brewed for 6s", "Moonwalking…", "Churned for 9s"
  /^(Worked|Brewed|Actualizing|Tomfoolering|Quantumizing|Moonwalking|Churned)\b/,
  // "∴ Thinking…" prefix line
  /^∴\s*Thinking/,
  // "thought for Xs)" suffix on any line
  /thought for \d+s\)/,
  // Stop hook output lines
  /^Ran \d+ stop hooks?$/i,
  /^⎿\s+~/,
  /^⎿\s+\/bin\//,
  /^⎿\s+Stop hook/,
  /Stop hook error/i,
  // Session start/hook error lines
  /^⎿\s+SessionStart/,
  /SessionStart:.*hook error/,
  /non-blocking status code/,
  // Spinner animation frames (lines with just digits, 1-3 chars)
  /^\d{1,3}$/,
  // TUI redraw fragments (very short meaningless fragments, 1-3 chars including mixed case)
  /^[A-Za-z…]{1,3}$/,
  // Percentage/progress: "0% 0/1.0M in:0 out:0 22:24:09"
  /^\d+%\s+\d+\/[\d.]+[kKmM]?/,
  // Thought duration: "5thought for 1s)"
  /\d+thought for \d+s\)/,
  // Token usage summary at bottom
  /\d[\d,.]*[kKmM]?\/[\d.]+[kKmM]?\s+in:\d/,
  // Effort level indicators
  /^◉\w+/,
  /\/effort$/,
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
    if (BOX_CHARS.test(trimmed) && trimmed.replace(/[─-╿▀-▟▔▌▐▄▀⎿⏺◉❯\s│╭╮╰╯]/g, "").length === 0) {
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

    // Remove box-drawing and TUI indicator characters from the line
    cleanedLine = cleanedLine.replace(/[─-╿▀-▟▔▌▐▄▀⎿⏺◉❯│╭╮╰╯]/g, "").trim();

    // Strip inline token counts: "↓ 16 tokens", "↓ 1 tokens", trailing "tokens" with numbers
    cleanedLine = cleanedLine.replace(/\s*↓?\s*\d+\s*tokens?\b/gi, "").trim();

    // Strip inline cost: "$0.23"
    cleanedLine = cleanedLine.replace(/\s*\$[\d.]+\b/g, "").trim();

    // Strip inline thought duration: "thought for 2s)"
    cleanedLine = cleanedLine.replace(/\s*thought for \d+s\)/g, "").trim();

    // Strip "running stop hooks" suffix
    cleanedLine = cleanedLine.replace(/\s*\(running stop hooks…[^\)]*\)/g, "").trim();

    // Skip if line became empty after box removal
    if (cleanedLine.length === 0) {
      continue;
    }

    // Skip stuttered TUI redraw fragments: "StStaStartStartiStarting" has repeated prefix
    if (hasStutteredPrefix(cleanedLine)) {
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

/**
 * Detect TUI redraw stuttering: cursor repositioning causes the same text to be
 * captured multiple times with increasing length, producing lines like
 * "StStaStartStartiStarting" where the same prefix repeats with small variations.
 *
 * Detection: find a substring (3+ chars) that appears 3+ times consecutively.
 */
function hasStutteredPrefix(line: string): boolean {
  for (let len = 3; len <= Math.floor(line.length / 3); len++) {
    for (let start = 0; start <= line.length - len * 3; start++) {
      const substr = line.slice(start, start + len);
      // Check if this substring repeats 3+ times consecutively
      let repetitions = 1;
      let pos = start + len;
      while (pos + len <= line.length && line.slice(pos, pos + len) === substr) {
        repetitions++;
        pos += len;
      }
      if (repetitions >= 3) {
        return true;
      }
    }
  }
  return false;
}
