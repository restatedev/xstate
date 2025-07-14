import { defineConfig } from "vitest/config";

export default defineConfig(() => {
  return {
    test: {
      projects: ["packages/*"],
    },
  };
});
