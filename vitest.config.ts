import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // component tests opt into jsdom with a `@vitest-environment jsdom` comment
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
