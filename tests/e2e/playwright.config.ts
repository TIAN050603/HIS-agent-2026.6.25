import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.HIS_BASE_URL || "http://10.26.6.8:31684";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "";
const runMicE2E = process.env.RUN_MIC_E2E === "1";
const chromiumLaunchOptions = {
  ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
  ...(runMicE2E ? {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--unsafely-treat-insecure-origin-as-secure=${baseURL}`
    ]
  } : {})
};

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: runMicE2E ? ["microphone"] : [],
        launchOptions: Object.keys(chromiumLaunchOptions).length ? chromiumLaunchOptions : undefined
      }
    }
  ]
});
