import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // component tests opt into jsdom with a `@vitest-environment jsdom` comment
    include: ["src/**/*.test.{ts,tsx}"],
    // Some component tests play whole tournaments in jsdom (about 2 s each); leave room on a busy machine.
    testTimeout: 20_000,
  },
});
