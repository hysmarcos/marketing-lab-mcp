import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Several tests assert wall-clock CPU budgets; running files in parallel makes them flaky.
    fileParallelism: false,
  },
});
