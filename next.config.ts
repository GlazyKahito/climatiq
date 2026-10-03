import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The seed loads committed data files at runtime (geography + ERA5 snapshot) for demo auto-initialisation.
  outputFileTracingIncludes: {
    '/**': ['./src/server/db/seed/data/**/*', './drizzle/**/*'],
  },
  poweredByHeader: false,
};

export default nextConfig;
