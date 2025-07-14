import { mergeConfig } from "vitest/config";
import { baseConfig } from "../../vitest.base.config";

export default mergeConfig(baseConfig, {
  test: {
    include: ["src/**/*.test.ts"],
    watch: process.argv.includes("--watch"),
  },
});
