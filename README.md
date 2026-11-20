# @butshouldwe/oxlint-config

Shared strict oxlint layer: Effect correctness,
antipattern and effectNative presets, then Ultracite anti-slop 8.0.1.
The spacing rule stays off because oxfmt owns layout.
Four rules from `@interfere/landmines` 0.1.0 guard test sleeps and signals.

## Install

Install from npm with the pinned peer toolchain:

```sh
pnpm add -D @butshouldwe/oxlint-config @effect/tsgo@0.70.0 \
  oxlint@1.94.0 oxlint-tsgolint@7.0.2007 ultracite@8.0.1
pnpm exec effect-tsgo patch --oxlint
```

Keep `effect-tsgo patch --oxlint` in the consumer's prepare script.
The Effect rules need those patched binaries. This package does not patch
the consumer through an install hook. Commit the updated lockfile, then
verify installation with `pnpm install --frozen-lockfile`.

## Required consumer config

Use this object import in `oxlint.config.ts`, not a file path in `extends`:

```ts
import shared from "@butshouldwe/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [shared],
  plugins: [],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "error",
    style: "off",
  },
  options: {
    typeAware: true,
    typeCheck: true,
  },
  ignorePatterns: [
    "**/dist",
    "**/node_modules",
    "**/.agents/**",
    "**/.claude/**",
    "**/.agents/skills",
    "**/.claude/skills",
  ],
});
```

Categories and options are required at the root, not hidden in `extends`.
Ignores belong to each consumer.
`plugins: []` prevents oxlint from adding root defaults back during inheritance.
Effect rules keep their existing warning severities. Other enabled categories
use errors. This package does not add Ultracite core, Vitest or style presets.

## Module mocking ban

The preset bans `vi.mock` and `vi.doMock`.
Fake the boundary through its real interface instead. The preset pins
Ultracite's `anti-slop/no-module-mocking` rule at error. It reports:

- `vi.mock`, `vi.doMock` and `vi.unstable_mockModule`, also as `vi?.mock`,
  `vi.mock?.()` and `vi["mock"]`;
- an aliased import such as `import { vi as v } from "vitest"`;
- `jest.mock` from the global or `@jest/globals`.

It does not report `vi.fn`, `vi.spyOn`, `vi.useFakeTimers` or a local `mock`
method. It also cannot see a destructured `const { mock } = vi`, a rebound
`const v = vi`, a template-literal key, `globalThis.vi.mock` or `vi.importMock`.
The diagnostic text is Ultracite's and names the alternative: dependency
injection through a real interface. `tests/module-mocking.test.mjs` proves
the rule fires on `.ts` and `.tsx` test files through the real CLI.

## Sleep and signal guards

The preset turns on four rules from `@interfere/landmines` 0.1.0 at error.
The package installs with this one; a consumer adds nothing.

| Rule                                   | Reports                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `landmines-testing/no-fixed-sleep`     | an awaited real-time sleep in a test or hook body                                                     |
| `landmines-testing/no-unsignaled-poll` | `expect.poll` or `vi.waitFor` on a collection's `length` or `size`; `vi.waitFor` on a spy             |
| `landmines-testing/strict-msw`         | an MSW server or worker started without an inline `onUnhandledRequest` set to `"error"` or a function |
| `landmines-structure/package-exports`  | a `package.json` export such as `"./*": "./src/*.ts"`                                                 |

A sleep is `await new Promise((resolve) => setTimeout(resolve, ms))`, a named
`setTimeout` import from `node:timers/promises`, the global `scheduler.wait`
or `Bun.sleep`. Await the operation or an event, or move time with
`vi.useFakeTimers()`.

The sleep rule does not report:

- a sleep inside a helper function, such as `await sleep(50)`;
- a timer callback with a block body, such as
  `setTimeout(() => { resolve(); }, 50)`;
- a `function` timer callback;
- any file that calls `vi.useFakeTimers()`, real sleeps included;
- a test or hook under another name, such as `import { test as check }` or
  `vt.test` from a namespace import;
- a timer from a namespace import of `node:timers/promises`, such as
  `timers.setTimeout(50)`, or a renamed `scheduler` import.

The pinned version also has these limits:

- The sleep rule knows a fake clock only as `vi.useFakeTimers()`. With
  `import { vi as clock }` it reports a sleep that the fake clock moves.
- The poll rule does not report `expect.poll(() => spy).toHaveBeenCalled()`.
  It reports the same check written with `vi.waitFor`.
- The MSW rule reads only an object written in the start call. It accepts
  `onUnhandledRequest: "error"` and any function value, a callback that does
  nothing included. It reports a quoted key, `{ "onUnhandledRequest": "error" }`,
  and options passed in a variable, although both are strict. It does not
  report a later spread that replaces the option. It does not see a start on
  a server or worker imported from another file.

Every other landmines rule stays off. `no-test-doubles` bans fakes the fleet
test policy allows, `no-flake-masking` bans every raised timeout, and the
comment, return-type and file-layout rules are not fleet policy.
`tests/landmines.test.mjs` proves each pinned rule through the real CLI and
fails when a blind spot closes or another landmines rule turns on.

To keep existing sleeps in a file, restate the rule in the consumer config
with a path and a count. The rule then fails when the count drops:

```jsonc
"landmines-testing/no-fixed-sleep": ["error", { "allow": { "test/slow.test.ts": 2 } }]
```

The path matches the end of a file path, so `test/slow.test.ts` also covers
`pkg/test/slow.test.ts`. Write a path that names one file in the repo. The
poll rule and the MSW rule take the same option with the same matching.

## Verify

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

Tests run this README's config against the original source fixture.
They read the complete `oxlint --print-config` output, all 258 resolved rules
and severities. The four landmines rules are asserted one by one, and the
other 254 must equal the fixture's.
Oxlint 1.94 lists `jsPlugins` and the anti-slop rules in that output. Separate
checks still preserve the plugin-bearing layers and compare real lint
diagnostics, including a seeded anti-slop error and a TypeScript compiler error.

The package test runs a real `npm pack` and checks the file allowlist,
MIT metadata, internal references and secrets. It requires Python 3.11+
and gitleaks 8.21.2. Run `bash scripts/install-check-tools.sh` to install
the pinned scanner into `.tools/`, then add `.tools` to your PATH.
Run `pnpm publish:check` for publint and the TypeScript resolution check.
CI verifies but never publishes. Never overwrite a published version.

## Public source export

The public repository is an export of the canonical repository.
`receipts`, `.forgejo` and `.lyra` stay out of that export.
The three scripts `scripts/public_export.py`, `scripts/public-export.sh` and
`scripts/public-export-check.sh` are copies of the local-gates source.
Run `sha256sum --strict -c .public-export-source` to verify their bytes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks and for how a pull
request lands. Report a suspected vulnerability in private: see
[SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
