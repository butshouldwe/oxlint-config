import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { antipattern, correctness, effectNative } from "@effect/tsgo/oxlint-presets";
import antiSlop from "ultracite/oxlint/anti-slop";
import shared from "@butshouldwe/oxlint-config";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const oxlint = join(root, "node_modules/.bin/oxlint");
const baseline = join(root, "tests/fixtures/baseline.config.ts");

test("toolchain peers and upstream oracle stay pinned", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.peerDependencies, {
    "@effect/tsgo": "0.70.0",
    oxlint: "1.94.0",
    "oxlint-tsgolint": "7.0.2007",
    ultracite: "8.0.1",
  });
  assert.equal(
    createHash("sha256").update(readFileSync(baseline)).digest("hex"),
    "a5193b7367179ad09f5f773e41588a92dd1342225cb176c0adf9cebc2380f9e7",
    "baseline fixture bytes must stay pinned",
  );
});

function run(cwd, config, args) {
  const result = spawnSync(oxlint, ["--config", config, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function fixture(check) {
  const dir = mkdtempSync(join(root, "tests/.work-"));
  try {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const snippet = readme.match(/```ts\n([\s\S]*?)\n```/);
    assert.ok(snippet, "README must include the required consumer config");
    const config = join(dir, "oxlint.config.ts");
    writeFileSync(config, snippet[1]);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", noEmit: true },
        include: ["seed.ts"],
      }),
    );
    writeFileSync(join(dir, "seed.ts"), "export const clean = 1;\n");
    check(dir, config);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The preset adds four landmines rules and their two plugins to the oracle.
// Take exactly those out of the resolved consumer config and return the rest.
function withoutLandmines(resolved) {
  const isLandmines = (name) => name.startsWith("landmines-");
  const added = Object.fromEntries(
    Object.entries(resolved.rules).filter(([name]) => isLandmines(name)),
  );
  assert.deepEqual(added, {
    "landmines-structure/package-exports": "deny",
    "landmines-testing/no-fixed-sleep": "deny",
    "landmines-testing/no-unsignaled-poll": "deny",
    "landmines-testing/strict-msw": "deny",
  });
  // oxlint prints JS plugins in no fixed order, so compare the names sorted.
  const plugins = resolved.jsPlugins.map((plugin) => plugin.name).filter(isLandmines);
  assert.deepEqual(plugins.toSorted(), ["landmines-structure", "landmines-testing"]);
  return {
    ...resolved,
    jsPlugins: resolved.jsPlugins.filter((plugin) => !isLandmines(plugin.name)),
    rules: Object.fromEntries(
      Object.entries(resolved.rules).filter(([name]) => !isLandmines(name)),
    ),
  };
}

test("README consumer resolves like the baseline plus the four landmines rules", () => {
  fixture((dir, config) => {
    const original = run(dir, baseline, ["--print-config", "seed.ts"]);
    const consumer = run(dir, config, ["--print-config", "seed.ts"]);
    assert.equal(original.status, 0, original.stderr);
    assert.equal(consumer.status, 0, consumer.stderr);
    const resolved = JSON.parse(consumer.stdout);
    assert.deepEqual(withoutLandmines(resolved), JSON.parse(original.stdout));
    assert.equal(resolved.options.typeAware, true);
    assert.equal(resolved.options.typeCheck, true);
    assert.equal(Object.keys(resolved.rules).length, 258);
  });
});

test("shared layer preserves every JS plugin rule and Effect preset in order", () => {
  assert.deepEqual(shared.extends, [correctness, antipattern, effectNative, antiSlop]);
  assert.deepEqual(shared.rules, {
    "anti-slop/require-readable-spacing": "off",
    "anti-slop/no-module-mocking": "error",
    "landmines-testing/no-fixed-sleep": "error",
    "landmines-testing/no-unsignaled-poll": "error",
    "landmines-testing/strict-msw": "error",
    "landmines-structure/package-exports": "error",
  });
  assert.equal("categories" in shared, false, "categories belong to the root");
  assert.equal("options" in shared, false, "options belong to the root");
  assert.equal("ignorePatterns" in shared, false, "ignores belong to the consumer");
  assert.equal(antiSlop.jsPlugins.length, 1);
  assert.equal(antiSlop.jsPlugins[0].name, "anti-slop");
});

test("real lint inherits JS plugin severity, spacing override and type checking", () => {
  fixture((dir, config) => {
    writeFileSync(
      join(dir, "seed.ts"),
      [
        "export function parsePort(raw: string): number {",
        "  const value = JSON.parse(raw) as unknown as { port: number };",
        "  return value.port;",
        "}",
        'export const wrong: number = "not a number";',
        "",
      ].join("\n"),
    );
    const original = run(dir, baseline, ["--format", "json", "seed.ts"]);
    const consumer = run(dir, config, ["--format", "json", "seed.ts"]);
    assert.equal(original.status, 1, original.stderr);
    assert.equal(consumer.status, 1, consumer.stderr);
    const before = JSON.parse(original.stdout).diagnostics;
    const after = JSON.parse(consumer.stdout).diagnostics;
    assert.deepEqual(after, before);
    assert.ok(
      after.some(
        (d) => d.code === "anti-slop(no-chained-type-assertions)" && d.severity === "error",
      ),
    );
    assert.ok(after.some((d) => d.code.includes("(TS2322)") && d.severity === "error"));
    assert.equal(
      after.some((d) => d.code === "anti-slop(require-readable-spacing)"),
      false,
    );
  });
});
