import shared from "@butshouldwe/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [shared],
  plugins: [],
  categories: { correctness: "error", suspicious: "error", perf: "error", style: "off" },
  options: { typeAware: true, typeCheck: true },
});
