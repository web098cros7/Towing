import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // MapLibre paints into WebGL, which headless Chromium has no GPU for.
        // SwiftShader is the software rasteriser that makes the canvas real in
        // CI; without it every map test would assert against the fallback panel.
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'pnpm exec next start -p 3000',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
