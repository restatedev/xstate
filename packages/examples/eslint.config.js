import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import base from "../../eslint.base.js";

export default defineConfig([
  ...base,
  tseslint.config(tseslint.configs.strictTypeChecked, {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNever: true,
          allowArray: true,
          allowAny: true,
          allowBoolean: true,
          allowNullish: true,
          allowNumber: true,
          allowRegExp: true,
        },
      ],
    },
  }),
]);
