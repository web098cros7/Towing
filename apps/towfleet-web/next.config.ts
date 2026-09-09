import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@towing/theme', '@towing/web-ui', '@towing/api-contracts'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
