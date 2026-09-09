import path from 'path';
import type { NextConfig } from 'next';

// Monorepo root — two levels up from apps/towfleet-web.
const repoRoot = path.join(__dirname, '../../');

const nextConfig: NextConfig = {
  // Shared workspace packages ship as raw TS source (repo convention — no
  // build step); Next must transpile them. Removing an entry here breaks
  // imports with confusing parse errors.
  transpilePackages: ['@towing/theme', '@towing/web-ui', '@towing/api-contracts'],

  // Bundle the server + all required node_modules into .next/standalone.
  // Required for AWS Amplify SSR (Web Compute) with a pnpm monorepo — Amplify's
  // Lambda runs the standalone server directly without an external node_modules.
  output: 'standalone',

  // Tell the standalone tracer where the monorepo root is so it can resolve
  // workspace symlinks (packages/@towing/*) correctly.
  outputFileTracingRoot: repoRoot,

  // Exclude the other apps and heavy directories that are never imported at
  // runtime. Without this, the tracer walks the entire monorepo (backend +
  // mobile apps + Playwright fixtures) and exhausts the 8 GiB build memory.
  outputFileTracingExcludes: {
    '*': [
      // Other workspace apps — none of their files are needed at runtime.
      'apps/backend/**',
      'apps/towgo/**',
      'apps/towpartner/**',
      // Test infrastructure.
      '**/__tests__/**',
      '**/e2e/**',
      '**/*.test.*',
      '**/*.spec.*',
      // Build-time-only tools — not imported at runtime.
      '**/node_modules/@playwright/**',
      '**/node_modules/typescript/**',
      '**/node_modules/turbo/**',
      '**/node_modules/prettier/**',
      '**/node_modules/eslint/**',
      '**/node_modules/@swc/**',
      '**/node_modules/esbuild/**',
      // Expo / React Native (mobile app deps pulled into the hoisted store).
      '**/node_modules/expo/**',
      '**/node_modules/react-native/**',
      '**/node_modules/@react-native/**',
      '**/node_modules/@expo/**',
    ],
  },

  /**
   * NEXT_PUBLIC_USE_MOCKS is inlined at 
ext build, so mocks-on and
   * mocks-off are two different builds that cannot share one output directory —
   * and the hermetic Playwright suite must keep its mocks-on build intact while
   * the live rehearsal runs against a real backend.
   *
   * 
ext start reads distDir from this same config, so one environment
   * variable selects the build for both the build and the serve
   * (NEXT_DIST_DIR=.next-live). See docs/rehearsal.md.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
