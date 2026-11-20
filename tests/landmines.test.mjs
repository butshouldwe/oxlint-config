import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import shared from "@butshouldwe/oxlint-config";

// Fleet test policy: no real sleep where a fake clock or an event works.
// @interfere/landmines owns the rules; oxlint 1.94 lists them in
// --print-config, but only a real lint run can prove which of them fire.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const oxlint = join(root, "node_modules/.bin/oxlint");

// R2: consumers read these four diagnostics. Every other landmines rule is off.
const pinned = {
  "landmines-testing/no-fixed-sleep": "landmines-testing(no-fixed-sleep)",
  "landmines-testing/no-unsignaled-poll": "landmines-testing(no-unsignaled-poll)",
  "landmines-testing/strict-msw": "landmines-testing(strict-msw)",
  "landmines-structure/package-exports": "landmines-structure(package-exports)",
};
const sleepCode = pinned["landmines-testing/no-fixed-sleep"];
const pollCode = pinned["landmines-testing/no-unsignaled-poll"];
const mswCode = pinned["landmines-testing/strict-msw"];
const exportsCode = pinned["landmines-structure/package-exports"];

const header = [
  'import { setTimeout as nodeSleep } from "node:timers/promises";',
  'import { beforeEach, expect, test, vi } from "vitest";',
  "declare function operation(): Promise<number>;",
  "declare const emitter: { once(name: string, done: (value: unknown) => void): void };",
  "declare const requests: string[];",
];

// Each row is one statement on one line; `true` marks a line the rule must report.
const sleeps = [
  [true, 'test("a", async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });'],
  [
    true,
    'test("b", async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });',
  ],
  [
    true,
    'test("c", async () => { await new Promise<void>((done) => globalThis.setTimeout(() => done(), 50)); });',
  ],
  [true, 'test("d", async () => { await nodeSleep(50); });'],
  [true, "beforeEach(async () => { await scheduler.wait(10); });"],
  [false, 'test("e", async () => { expect(await operation()).toBe(1); });'],
  [
    false,
    'test("f", async () => { await new Promise((resolve) => { emitter.once("done", resolve); }); });',
  ],
  [
    false,
    'test("g", async () => { const timer = setTimeout(() => {}, 10); await operation(); clearTimeout(timer); });',
  ],
];

function source(rows) {
  return [...header, ...rows.map(([, line]) => line), ""].join("\n");
}

function flaggedLines(rows) {
  return rows.flatMap(([flagged], index) => (flagged ? [header.length + index + 1] : []));
}

// `support` files are written beside the linted files but not linted.
// `configure` edits the README consumer config before the run.
function lint(files, support = {}, configure = (config) => config) {
  const dir = mkdtempSync(join(root, "tests/.work-"));
  try {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const snippet = readme.match(/```ts\n([\s\S]*?)\n```/);
    assert.ok(snippet, "README must include the required consumer config");
    writeFileSync(join(dir, "oxlint.config.ts"), configure(snippet[1]));
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", noEmit: true },
        include: Object.keys(files),
      }),
    );
    for (const [name, text] of Object.entries({ ...support, ...files })) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    // The work directory is hidden, so name every file explicitly.
    const result = spawnSync(
      oxlint,
      ["--config", "oxlint.config.ts", "--format", "json", ...Object.keys(files)],
      { cwd: dir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000 },
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.number_of_files, Object.keys(files).length, result.stdout);
    return report.diagnostics;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The README wraps its prose; a statement is matched on one line.
function readmeProse() {
  return readFileSync(join(root, "README.md"), "utf8").replaceAll(/\s+/gu, " ");
}

function lines(diagnostics, filename, code, message) {
  return diagnostics
    .filter((d) => d.filename === filename && d.code === code)
    .map((d) => {
      assert.equal(d.severity, "error", `${filename}: ${JSON.stringify(d)}`);
      assert.match(d.message, message);
      return d.labels[0].span.line;
    })
    .toSorted((a, b) => a - b);
}

function landminesCodes(diagnostics) {
  return [
    ...new Set(diagnostics.map((d) => d.code).filter((code) => code.startsWith("landmines-"))),
  ];
}

test("shared preset pins four landmines rules at error and enables no other", () => {
  for (const rule of Object.keys(pinned)) {
    assert.equal(shared.rules[rule], "error", rule);
  }
  assert.deepEqual(
    Object.keys(shared.rules)
      .filter((rule) => rule.startsWith("landmines-"))
      .toSorted(),
    Object.keys(pinned).toSorted(),
  );
  assert.deepEqual(
    shared.jsPlugins.map((plugin) => plugin.name),
    ["landmines-testing", "landmines-structure"],
  );
  for (const plugin of shared.jsPlugins) {
    assert.ok(isAbsolute(plugin.specifier), `${plugin.name} must load from an absolute path`);
    assert.ok(existsSync(plugin.specifier), `${plugin.name} must resolve to an installed file`);
    assert.match(plugin.specifier, /@interfere\/landmines\/dist\/(testing|structure)\.mjs$/);
  }
});

test("a fixed real-time sleep in a test or hook is an error; awaited work is not", () => {
  const diagnostics = lint({ "sleep.test.ts": source(sleeps) });
  assert.deepEqual(
    lines(diagnostics, "sleep.test.ts", sleepCode, /Replace this fixed sleep with a signal/),
    flaggedLines(sleeps),
  );
  assert.deepEqual(landminesCodes(diagnostics), [sleepCode]);
});

test("negative control: a test file with no sleep gets no landmines report", () => {
  const clean = sleeps.filter(([flagged]) => !flagged);
  assert.equal(clean.length, 3, "negative fixture keeps every allowed wait");
  const diagnostics = lint({ "clean.test.ts": source(clean) });
  assert.deepEqual(landminesCodes(diagnostics), []);
});

// Accepted risk, listed in the README. If a landmines upgrade starts to see
// one of these shapes, this test fails so the README stops understating it.
test("README blind spots match what the sleep rule cannot see", () => {
  const blind = [
    "const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));",
    'test("helper", async () => { await sleep(50); });',
    'test("block", async () => { await new Promise<void>((resolve) => setTimeout(() => { resolve(); }, 50)); });',
    'test("function", async () => { await new Promise<void>((resolve) => setTimeout(function () { resolve(); }, 50)); });',
    'import { test as check } from "vitest";',
    'import * as vt from "vitest";',
    'import * as timers from "node:timers/promises";',
    'import { scheduler as later } from "node:timers/promises";',
    'check("renamed", async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });',
    'vt.test("namespace", async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });',
    'test("timers", async () => { await timers.setTimeout(50); });',
    'test("later", async () => { await later.wait(50); });',
  ];
  const readme = readmeProse();
  for (const shape of [
    "a sleep inside a helper function",
    "a timer callback with a block body",
    "a `function` timer callback",
    "any file that calls `vi.useFakeTimers()`",
    "a test or hook under another name",
    "a timer from a namespace import of `node:timers/promises`",
    "a renamed `scheduler` import",
    "With `import { vi as clock }` it reports a sleep that the fake clock moves",
  ]) {
    assert.ok(readme.includes(shape), `README must list the blind spot: ${shape}`);
  }
  const visible =
    'test("seen", async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });';
  const diagnostics = lint({
    "blind.test.ts": [...header, ...blind, visible, ""].join("\n"),
    "fake-timers.test.ts": [...header, "vi.useFakeTimers();", visible, ""].join("\n"),
    "renamed-clock.test.ts": [
      'import { test, vi as clock } from "vitest";',
      "clock.useFakeTimers();",
      visible,
      "",
    ].join("\n"),
  });
  assert.deepEqual(
    lines(diagnostics, "blind.test.ts", sleepCode, /fixed sleep/),
    [header.length + blind.length + 1],
    "only the plain sleep after the blind shapes is reported",
  );
  assert.deepEqual(lines(diagnostics, "fake-timers.test.ts", sleepCode, /fixed sleep/), []);
  assert.deepEqual(
    lines(diagnostics, "renamed-clock.test.ts", sleepCode, /fixed sleep/),
    [3],
    "a fake clock under another name does not exempt the file",
  );
});

// Each row is one statement on one line; `true` marks a line the rule must report.
// The rows after the third are limits of the pinned rule that the README
// states: strict starts it reports and lenient starts it accepts.
const mswStarts = [
  [true, "server.listen();"],
  [false, 'server.listen({ onUnhandledRequest: "error" });'],
  [true, 'server.listen({ onUnhandledRequest: "warn" });'],
  [true, 'server.listen({ "onUnhandledRequest": "error" });'],
  [true, 'await worker.start({ "onUnhandledRequest": "error" });'],
  [true, "server.listen(strictOptions);"],
  [false, "server.listen({ onUnhandledRequest: () => {} });"],
  [false, "await worker.start({ onUnhandledRequest: () => {} });"],
  [false, 'server.listen({ onUnhandledRequest: "error", ...lenientOptions });'],
];

const polls = [
  [true, 'test("length", async () => { await expect.poll(() => requests.length).toBe(1); });'],
  [
    true,
    'test("waited", async () => { await vi.waitFor(() => expect(spy).toHaveBeenCalled()); });',
  ],
  [false, 'test("polled", async () => { await expect.poll(() => spy).toHaveBeenCalled(); });'],
  [false, 'test("state", async () => { await expect.poll(() => document.title).toBe("ready"); });'],
];

test("signal guards: a lenient MSW start and a poll on recorder state are errors", () => {
  const mswHeader = [
    'import { setupWorker } from "msw/browser";',
    'import { setupServer } from "msw/node";',
    "const server = setupServer();",
    "const worker = setupWorker();",
    'const strictOptions = { onUnhandledRequest: "error" } as const;',
    'const lenientOptions = { onUnhandledRequest: "bypass" } as const;',
  ];
  const pollHeader = [...header, "declare const spy: () => void;"];
  const reported = (top, rows) =>
    rows.flatMap(([flagged], index) => (flagged ? [top.length + index + 1] : []));
  const text = (top, rows) => [...top, ...rows.map(([, line]) => line), ""].join("\n");
  const readme = readmeProse();
  for (const limit of [
    "any function value, a callback that does nothing included",
    'It reports a quoted key, `{ "onUnhandledRequest": "error" }`',
    "options passed in a variable, although both are strict",
    "It does not report a later spread that replaces the option",
    "It does not see a start on a server or worker imported from another file",
    "The poll rule does not report `expect.poll(() => spy).toHaveBeenCalled()`",
  ]) {
    assert.ok(readme.includes(limit), `README must state the limit: ${limit}`);
  }
  const diagnostics = lint(
    {
      "network.test.ts": text(mswHeader, mswStarts),
      "poll.test.ts": text(pollHeader, polls),
      "imported.test.ts": [
        'import { server } from "./mocks/server";',
        'server.listen({ onUnhandledRequest: "bypass" });',
        "",
      ].join("\n"),
    },
    {
      "mocks/server.ts":
        'import { setupServer } from "msw/node";\nexport const server = setupServer();\n',
    },
  );
  assert.deepEqual(
    lines(diagnostics, "imported.test.ts", mswCode, /./),
    [],
    "the pinned rule does not follow an import to the server",
  );
  assert.deepEqual(
    lines(diagnostics, "network.test.ts", mswCode, /onUnhandledRequest: "error"/),
    reported(mswHeader, mswStarts),
  );
  assert.deepEqual(
    lines(diagnostics, "poll.test.ts", pollCode, /Await a signal instead of polling/),
    reported(pollHeader, polls),
  );
  assert.deepEqual(landminesCodes(diagnostics).toSorted(), [mswCode, pollCode].toSorted());
});

test("package guard: a wildcard source export is an error; a named entrypoint is not", () => {
  // The manifest sits in its own directory: a package.json beside the config
  // would end this repository's self-reference and the config would not load.
  const files = { "pkg/src/client.ts": "export const client = 1;\n" };
  const manifest = (exports) => ({
    "pkg/package.json": JSON.stringify({ name: "fixture", exports }),
  });
  const open = lint(files, manifest({ "./*": "./src/*.ts" }));
  assert.deepEqual(
    lines(open, "pkg/src/client.ts", exportsCode, /Declare explicit entrypoints/),
    [1],
  );
  const named = lint(files, manifest({ "./client": "./src/client.ts" }));
  assert.deepEqual(landminesCodes(named), []);
});

// R2: the README tells a consumer how to keep an existing sleep. The count is
// exact: more sleeps report, and fewer make the allowance itself an error.
test("a consumer allowance covers exactly its count and fails when the file improves", () => {
  const sleep = (name) =>
    `test("${name}", async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });`;
  const file = (count) =>
    [...header, ...Array.from({ length: count }, (_, index) => sleep(`s${index}`)), ""].join("\n");
  const allowTwo = (config) => {
    const anchor = "extends: [shared],";
    assert.equal(config.split(anchor).length, 2, "README config must extend the preset once");
    const rule = '"landmines-testing/no-fixed-sleep": ["error", { allow: { "kept.test.ts": 2 } }]';
    return config.replace(anchor, `${anchor}\n  rules: { ${rule} },`);
  };
  const run = (count) =>
    lint(
      { "kept.test.ts": file(count), "other.test.ts": file(1), "pkg/kept.test.ts": file(2) },
      {},
      allowTwo,
    );
  const exact = run(2);
  assert.deepEqual(lines(exact, "kept.test.ts", sleepCode, /./), []);
  // The README says so: the path matches the end of a file path.
  assert.deepEqual(lines(exact, "pkg/kept.test.ts", sleepCode, /./), []);
  assert.match(
    readmeProse(),
    /The path matches the end of a file path, so `test\/slow\.test\.ts` also covers `pkg\/test\/slow\.test\.ts`/,
  );
  assert.deepEqual(lines(exact, "other.test.ts", sleepCode, /fixed sleep/), [header.length + 1]);
  assert.equal(lines(run(3), "kept.test.ts", sleepCode, /fixed sleep/).length, 3);
  assert.deepEqual(
    lines(run(1), "kept.test.ts", sleepCode, /lower its no-fixed-sleep allowlist/),
    [1],
  );
});

// The plugins that hold the four pinned rules also hold these. The preset
// leaves them off on purpose: they ban fakes the fleet policy allows, or
// they are layout and timeout rules with hundreds of existing hits.
test("landmines rules the preset leaves off report nothing", () => {
  const off = [
    'import { expect, test, vi } from "vitest";',
    "const stub = vi.fn(() => 1);",
    'vi.stubGlobal("fetch", stub);',
    'test("retried", { retry: 2 }, () => { expect(stub()).toBe(1); });',
    'test("slow", () => { expect(stub()).toBe(1); }, 60_000);',
    "",
  ].join("\n");
  const diagnostics = lint({
    "left-off.test.ts": off,
    "helpers.ts": "export const helper = 1;\n",
    "left-off.spec.ts": 'import { test } from "vitest";\ntest("named", () => {});\n',
  });
  assert.deepEqual(landminesCodes(diagnostics), []);
});
