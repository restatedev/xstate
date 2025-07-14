import { defineConfig } from "vitest/config";
import path from "path";

const isWatch =
  (process.argv.includes("--watch") || process.argv.includes("watch")) &&
  !process.argv.includes("run");

export const baseConfig = defineConfig({
  test: {
    globals: true,
    environment: "node",
    projects: ["packages/*"],
    watch: isWatch,
    passWithNoTests: true,
  },
  ...(isWatch && {
    resolve: {
      alias: {
        "@restatedev/xstate": path.resolve(
          __dirname,
          "./packages/restate-xstate/src/index.ts",
        ),
        "@restatedev/xstate-test": path.resolve(
          __dirname,
          "./packages/restate-xstate-test/src/index.ts",
        ),
      },
      preserveSymlinks: true,
    },
    optimizeDeps: {
      exclude: ["@restatedev/xstate", "@restatedev/xstate-test"],
    },
  }),
});
