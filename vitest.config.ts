import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts", "tests/test_*.ts"],
    passWithNoTests: true,
  },
});
