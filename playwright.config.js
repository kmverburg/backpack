const { defineConfig, devices } = require('@playwright/test');
const os = require('os'), path = require('path'), fs = require('fs');

// Fresh local KV store per run, so tests never touch real or earlier data.
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'backpack-test-'));
const PORT = 8788;
// Worker log lines (console output of wrangler dev) go to a file the tests can read.
process.env.BACKPACK_TEST_LOG = path.join(os.tmpdir(), 'backpack-worker-test.log');

module.exports = defineConfig({
  testDir: 'tests',
  workers: 1, // all tests share one local KV store
  fullyParallel: false,
  use: {
    baseURL: `http://localhost:${PORT}`,
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': 'local-test' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node tests/photon-mock.js', url: 'http://localhost:8789/__hits', reuseExistingServer: false },
    {
      // PHOTON_URL points the places search at the mock, so tests never call the real service.
      command: `npx wrangler dev --port ${PORT} --persist-to "${persist}" --var PHOTON_URL:http://localhost:8789/api/ > "${process.env.BACKPACK_TEST_LOG}" 2>&1`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
