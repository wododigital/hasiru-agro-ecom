import type { NextConfig } from 'next';

// Proof store assembled from generic modules only (pick-and-choose recipe).
const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  output: 'standalone',
  poweredByHeader: false,
  // next dev would otherwise write an AGENTS.md into the app (no tool-guidance files in the client repo).
  agentRules: false,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  serverExternalPackages: ['sharp', 'pg', 'pg-boss'],
};

export default nextConfig;
