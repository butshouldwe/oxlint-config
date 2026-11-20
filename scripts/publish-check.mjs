#!/usr/bin/env node
// Adapted from butshouldwe/cypher 97404c09bec2aef31826fe434e25506941b43614.
// This package has no CSS entrypoints, so the source's CSS exclusions do not apply.
import { execFileSync } from "node:child_process";

const run = (cmd, args) => {
  process.stdout.write(`\n$ ${cmd} ${args.join(" ")}\n`);
  execFileSync(cmd, args, { stdio: "inherit" });
};

// CI has npm but may not have the packageManager-pinned pnpm on PATH.
run("publint", ["--strict", "--pack", "npm"]);
// The ESM-only profile permits CJS consumers to require a dynamic import.
run("attw", ["--pack", ".", "--profile", "esm-only"]);
