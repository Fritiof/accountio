import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3001';

const config: NextConfig = {
  // Pin the workspace root so Next.js doesn't get confused by the root bun.lock
  // (the root package.json exists for biome + husky tooling).
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url)),
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default config;
