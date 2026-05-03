const keySequences = {
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  enter: "\r",
  esc: "\x1b",
  tab: "\t",
  backspace: "\x7f",
  "ctrl-c": "\x03",
  "ctrl-d": "\x04",
  yes: "y\r",
  no: "n\r",
  cancel: "\x03",
} as const;

export const keyControlNames = Object.keys(keySequences) as KeyControlName[];

export type KeyControlName = keyof typeof keySequences;

export function keySequenceForControl(name: KeyControlName): string {
  const sequence = keySequences[name];
  if (sequence === undefined) {
    throw new Error(`Unknown terminal control: ${String(name)}`);
  }

  return sequence;
}
