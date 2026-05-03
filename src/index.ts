#!/usr/bin/env node
export { createProgram } from "./cli.js";
import { createProgram } from "./cli.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  await createProgram().parseAsync(process.argv);
}
