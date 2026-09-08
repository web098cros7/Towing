import { defineConfig, devices } from '@playwright/test';

/**
 * The MOCKS-OFF suite, for the multi-instance rehearsal (docs/rehearsal.md).
 *
 * A second config rather than a second project because `webServer` is
 * config-level in Playwright, and this suite deliberately has none: the
 * rehearsal runbook owns the processes — two backends, two Next instances and
 * the round-robin proxy in front of them. Starting a server here would defeat
 * the entire point, which is to drive a browser through more than one of each.
 *
 * The hermetic `e2e/` suite stays exactly as it is and keeps running against
 * the mocks-on build; nothing here touches it.
 */
export default defineConfig({
  testDir: './e2e-live',
  // Real database, real network, two hops through a proxy — a mock's budget
  // does not apply.
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    // Every assertion here crosses the proxy to one of two Next processes and
    // on to one of two backends.
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // MapLibre paints into WebGL and headless Chromium has no GPU; without
        // SwiftShader every map assertion lands on the fallback panel.
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
});
