import { defineConfig } from "@playwright/test";

// End-to-end smoke tests against the production build (CLAUDE.md §2, §5: `npm run e2e`).
// Uses the locally installed Chrome; on a machine without it run `npx playwright install chromium`
// and remove `channel`.
const PORT = 3107;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    locale: "ru-RU",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    // A 1440 px wide window at 200 % browser zoom lays out exactly like this.
    { name: "zoom200", use: { viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false, // always test a fresh build of the current code
    timeout: 240_000,
  },
});
