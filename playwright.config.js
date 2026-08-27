// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const fs = require('fs');

// The app ships to iPhone Safari, so WebKit is the browser that matters and is
// the default project.  Some sandboxes cannot download it (the Playwright CDN
// may be blocked by egress policy); the chromium project exists so the suite is
// still runnable there, pinned to a pre-installed binary.  It is a fallback,
// not a substitute: WebKit is what CI gates on.
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';
const PORT = Number(process.env.PORT || 8777);

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 14 Pro'] },   // defaultBrowserType: webkit
    },
    {
      name: 'iphone-chromium',
      use: {
        ...devices['iPhone 14 Pro'],
        browserName: 'chromium',
        ...(fs.existsSync(LOCAL_CHROMIUM) ? { launchOptions: { executablePath: LOCAL_CHROMIUM } } : {}),
      },
    },
  ],

  // Build the page from source, then serve it. Tests always run against a
  // freshly built web/index.html, never a stale one.
  webServer: {
    command: `python3 web/build.py && python3 -m http.server ${PORT} --directory web --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
