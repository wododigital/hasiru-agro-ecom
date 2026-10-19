import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Top-level in Next 16.4 (the plan listed it under experimental).
  partialPrefetching: true,
  reactCompiler: true,
  deploymentId: process.env.GIT_SHA,
  output: 'standalone',
  // proxy.ts issues the single canonical 301 (host, scheme, trailing slash, case); Next's own 308 would add a hop.
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  // next dev would otherwise write an AGENTS.md into the app (no tool-guidance files in the client repo).
  agentRules: false,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  serverExternalPackages: ['sharp', 'pg', 'pg-boss'],
  images: {
    formats: ['image/avif', 'image/webp'],
    qualities: [50, 75],
    minimumCacheTTL: 2678400,
    remotePatterns: [],
  },
  experimental: {
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
