import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Shared workspace packages ship as raw TS source (repo convention — no
  // build step); Next must transpile them. Removing an entry here breaks
  // imports with confusing parse errors.
  transpilePackages: ['@towing/theme', '@towing/web-ui', '@towing/api-contracts'],

  /**
   * `NEXT_PUBLIC_USE_MOCKS` is inlined at `next build`, so mocks-on and
   * mocks-off are two different builds that cannot share one output directory —
   * and the hermetic Playwright suite must keep its mocks-on build intact while
   * the live rehearsal runs against a real backend.
   *
   * `next start` reads `distDir` from this same config, so one environment
   * variable selects the build for both the build and the serve
   * (`NEXT_DIST_DIR=.next-live`). See docs/rehearsal.md.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
