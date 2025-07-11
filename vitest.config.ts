import { defineConfig } from "vitest/config";
import path from "path";

const isWatch =
  (process.argv.includes("--watch") || process.argv.includes("watch")) &&
  !process.argv.includes("run");

export default defineConfig(() => {
  return {
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
        },
      },
      optimizeDeps: {
        exclude: ["@restatedev/xstate"],
      },
    }),
  };
});
