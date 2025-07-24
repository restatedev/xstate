import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/promise.ts"],
  platform: "neutral",
  exports: true,
  format: ["esm", "cjs"],
  dts: true,
});
