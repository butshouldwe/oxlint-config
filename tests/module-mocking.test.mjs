import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import shared from "@butshouldwe/oxlint-config";

// bsw-vitest 1.1.0 bans vi.mock and vi.doMock. Ultracite's anti-slop plugin
// owns the rule; oxlint 1.94 lists it in --print-config, but only a real
// lint run can prove it fires.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const oxlint = join(root, "node_modules/.bin/oxlint");
const rule = "anti-slop/no-module-mocking";
const code = "anti-slop(no-module-mocking)";

// Each fixture line is a statement; `true` marks a line the rule must report.
const statements = [
  [true, 'vi.mock("./dep");'],
  [true, 'vi.doMock("./dep");'],
  [true, 'vi?.mock("./dep");'],
  [true, 'vi["mock"]("./dep");'],
  [true, 'vi["doMock"]("./dep");'],
  [true, 'aliased.mock("./dep");'],
  [false, "vi.fn();"],
  [false, 'vi.spyOn(console, "log");'],
  [false, "vi.useFakeTimers();"],
  [false, 'local.mock("./dep");'],
  [false, 'local["doMock"]("./dep");'],
  [false, 'shadowed({ mock: (path: string) => path }, "./dep");'],
];

const header = [
  'import { vi, vi as aliased } from "vitest";',
  "const local = { mock: (path: string) => path, doMock: (path: string) => path };",
  "function shadowed(vi: { mock: (path: string) => string }, path: string) {",
  "  return vi.mock(path);",
  "}",
];
const shadowedLine = 4;

function source(rows, extra) {
  return [...header, ...rows.map(([, line]) => line), ...extra, ""].join("\n");
}

function expectedLines() {
  return statements.flatMap(([flagged], index) => (flagged ? [header.length + index + 1] : []));
}

function lint(files) {
  const dir = mkdtempSync(join(root, "tests/.work-"));
  try {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const snippet = readme.match(/```ts\n([\s\S]*?)\n```/);
    assert.ok(snippet, "README must include the required consumer config");
    writeFileSync(join(dir, "oxlint.config.ts"), snippet[1]);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ESNext",
          module: "NodeNext",
          jsx: "react-jsx",
          noEmit: true,
        },
        include: Object.keys(files),
      }),
    );
    for (const [name, text] of Object.entries(files)) {
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
    return { status: result.status, diagnostics: report.diagnostics };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mockingLines(diagnostics, filename) {
  return diagnostics
    .filter((d) => d.filename === filename && d.code === code)
    .map((d) => {
      assert.equal(d.severity, "error", `${filename}: ${JSON.stringify(d)}`);
      assert.match(d.message, /dependency injection through a real interface/);
      return d.labels[0].span.line;
    })
    .toSorted((a, b) => a - b);
}

test("shared preset pins the module-mocking ban at error", () => {
  assert.equal(shared.rules[rule], "error");
});

test("module mocking is an error in .ts and .tsx tests; other vi calls are not", () => {
  const files = {
    "mocking.test.ts": source(statements, []),
    "mocking.test.tsx": source(statements, [
      'export const view = <div>{local.mock("./dep")}</div>;',
    ]),
  };
  const { status, diagnostics } = lint(files);
  assert.equal(status, 1, JSON.stringify(diagnostics));
  for (const name of Object.keys(files)) {
    const lines = mockingLines(diagnostics, name);
    assert.deepEqual(lines, expectedLines(), name);
    assert.equal(lines.includes(shadowedLine), false, `${name}: a local vi is not vitest`);
  }
});

test("negative control: a test file with no module mocking gets no ban report", () => {
  const clean = statements.filter(([flagged]) => !flagged);
  assert.equal(clean.length, 6, "negative fixture keeps every allowed vi and local call");
  const files = { "clean.test.ts": source(clean, []), "clean.test.tsx": source(clean, []) };
  const { diagnostics } = lint(files);
  for (const name of Object.keys(files)) {
    assert.deepEqual(mockingLines(diagnostics, name), [], name);
  }
});

// Accepted risk, listed in the README. If an Ultracite upgrade starts to see
// one of these shapes, this test fails so the README stops understating it.
test("README blind spots match what the rule cannot see", () => {
  const blind = [
    "const { mock } = vi;",
    'mock("./dep");',
    "const rebound = vi;",
    'rebound.mock("./dep");',
    'vi[`mock`]("./dep");',
    'globalThis.vi.mock("./dep");',
    'vi.importMock("./dep");',
  ];
  const readme = readFileSync(join(root, "README.md"), "utf8").replaceAll("\n", " ");
  for (const shape of [
    "destructured `const { mock } = vi`",
    "rebound `const v = vi`",
    "template-literal key",
    "`globalThis.vi.mock`",
    "`vi.importMock`",
  ]) {
    assert.ok(readme.includes(shape), `README must list the blind spot: ${shape}`);
  }
  const { diagnostics } = lint({
    "blind.test.ts": ['import { vi } from "vitest";', ...blind, 'vi.mock("./dep");', ""].join("\n"),
  });
  assert.deepEqual(mockingLines(diagnostics, "blind.test.ts"), [blind.length + 2]);
});
