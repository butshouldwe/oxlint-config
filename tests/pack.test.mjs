import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { delimiter, resolve } from "node:path";

test("public npm tarball has the exact files, MIT metadata and no internal references or secrets", () => {
  const result = spawnSync("python3", ["-B", "tests/check_pack.py"], {
    encoding: "utf8",
    env: { ...process.env, PATH: resolve(".tools") + delimiter + process.env.PATH },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
