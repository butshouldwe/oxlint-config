import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cases = [
  [
    "index.js",
    "correctness, antipattern, effectNative, antiSlop",
    "",
    "README consumer resolves like the baseline plus the four landmines rules",
  ],
  [
    "index.js",
    "correctness, antipattern, effectNative, antiSlop",
    "correctness, antipattern, effectNative",
    "real lint inherits JS plugin severity, spacing override and type checking",
  ],
  [
    "index.js",
    '"anti-slop/require-readable-spacing": "off"',
    '"anti-slop/require-readable-spacing": "error"',
    "real lint inherits JS plugin severity, spacing override and type checking",
  ],
  [
    "index.js",
    "correctness, antipattern, effectNative, antiSlop",
    "antiSlop",
    "README consumer resolves like the baseline plus the four landmines rules",
  ],
  [
    "README.md",
    'suspicious: "error"',
    'suspicious: "warn"',
    "README consumer resolves like the baseline plus the four landmines rules",
  ],
  [
    "README.md",
    "typeAware: true",
    "typeAware: false",
    "README consumer resolves like the baseline plus the four landmines rules",
  ],
  [
    "README.md",
    "typeCheck: true",
    "typeCheck: false",
    "real lint inherits JS plugin severity, spacing override and type checking",
  ],
  [
    "package.json",
    '"peerDependencies": {\n    "@effect/tsgo": "0.70.0",\n    "oxlint": "1.94.0"',
    '"peerDependencies": {\n    "@effect/tsgo": "0.70.0",\n    "oxlint": "^1.94.0"',
    "toolchain peers and upstream oracle stay pinned",
  ],
  [
    "index.js",
    '"anti-slop/no-module-mocking": "error"',
    '"anti-slop/no-module-mocking": "off"',
    "module mocking is an error in .ts and .tsx tests; other vi calls are not",
  ],
  [
    "index.js",
    '    "anti-slop/no-module-mocking": "error",\n',
    "",
    "shared preset pins the module-mocking ban at error",
  ],
  ["README.md", " or `vi.importMock`.", ".", "README blind spots match what the rule cannot see"],
  // The next two mutate the pinned upstream rule to prove the fixtures see
  // over-reporting (negative controls) and vitest import resolution.
  [
    "node_modules/ultracite/config/oxlint/anti-slop/plugin.mjs",
    "function isTestFrameworkObject(sourceCode, expression) {",
    "function isTestFrameworkObject(sourceCode, expression) {\n  return true;",
    "negative control: a test file with no module mocking gets no ban report",
  ],
  [
    "node_modules/ultracite/config/oxlint/anti-slop/plugin.mjs",
    'return source === "vitest" && name === "vi"',
    'return source === "vitest" && name === "never"',
    "module mocking is an error in .ts and .tsx tests; other vi calls are not",
  ],
  [
    "tests/fixtures/baseline.config.ts",
    "// Strict oxlint preset:",
    "// Changed oxlint preset:",
    "toolchain peers and upstream oracle stay pinned",
  ],
];

function suite() {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "tests/inheritance.test.mjs",
      "tests/module-mocking.test.mjs",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function green() {
  const result = suite();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /# pass 8\n/);
}

// pnpm hardlinks node_modules files to its global store, so an in-place write
// would mutate every project on the host. Replace the directory entry instead
// and prove the original inode was left alone.
function replace(path, bytes) {
  const original = statSync(path).ino;
  const temporary = `${path}.falsify-${process.pid}`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
  assert.notEqual(statSync(path).ino, original, `${path} must not be written in place`);
}

green();
for (const [relative, before, after, name] of cases) {
  const path = join(root, relative);
  const snapshot = readFileSync(path);
  const source = snapshot.toString();
  assert.equal(source.split(before).length, 2, `mutation anchor must be unique: ${relative}`);
  try {
    replace(path, source.replace(before, after));
    const result = suite();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const failures = result.stdout.split("\n").filter((line) => /^not ok \d+ - /.test(line));
    assert.ok(
      failures.some((line) => line.endsWith(name)),
      result.stdout,
    );
    console.log(`DETECTED ${relative}: ${before} -> ${after || "(removed)"}`);
    console.log(`  caught by: ${name}`);
  } finally {
    replace(path, snapshot);
    assert.deepEqual(readFileSync(path), snapshot);
  }
  green();
}
console.log(`PASS: ${cases.length} mutations detected; restored baseline passes after each`);
