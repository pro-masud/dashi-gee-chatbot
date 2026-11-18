import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: [
    '*.run.app',
    '*.asia-northeast1.run.app',
    'ais-dev-suqzhew43ibjkkiaxm6kcs-852078909534.asia-northeast1.run.app',
  ],
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
