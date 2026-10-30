import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:17380", trace: "retain-on-failure" },
});
