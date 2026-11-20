import { fileURLToPath } from "node:url";

import { antipattern, correctness, effectNative } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";

// An absolute path computed from this module, so oxlint loads the plugin
// however the consuming project lays out node_modules.
function landmines(entry) {
  return fileURLToPath(import.meta.resolve(`@interfere/landmines/${entry}`));
}

// Categories, root-only options and ignores stay in the consumer config.
export default defineConfig({
  extends: [correctness, antipattern, effectNative, antiSlop],
  jsPlugins: [
    { name: "landmines-testing", specifier: landmines("testing") },
    { name: "landmines-structure", specifier: landmines("structure") },
  ],
  rules: {
    "anti-slop/require-readable-spacing": "off",
    // Fleet test policy (bsw-vitest 1.1.0): no vi.mock or vi.doMock; fake the
    // boundary through its real interface. Pinned so an Ultracite bump cannot
    // drop the ban without failing tests/module-mocking.test.mjs.
    "anti-slop/no-module-mocking": "error",
    // Fleet test policy: no real sleep where a fake clock or an event works.
    // Only these four landmines rules are on. The rest of landmines stays off:
    // it bans fakes the policy allows, comments and explicit return types.
    // tests/landmines.test.mjs fails when a pin drops or another rule turns on.
    "landmines-testing/no-fixed-sleep": "error",
    "landmines-testing/no-unsignaled-poll": "error",
    "landmines-testing/strict-msw": "error",
    "landmines-structure/package-exports": "error",
  },
});
