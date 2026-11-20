import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("IP literals survive colon labels and prose decoration", () => {
  const result = spawnSync("python3", ["-B", "tests/test_pack_ips.py"], {
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
