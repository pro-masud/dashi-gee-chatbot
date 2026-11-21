import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  serverExternalPackages: ['firebase-admin'],
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
