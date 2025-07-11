import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
  globalIgnores([
    "dist/*",
    "node_modules/*",
    "package-lock.json",
    ".api/*",
    "**/tsdown.config.ts",
    "**/vitest.config.ts",
    "**/eslint.config.js",
  ]),
]);
