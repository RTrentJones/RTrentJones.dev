/** @type {import('next').NextConfig} */
const nextConfig = {
  // Greenlight's artifact-identity probe hits /__version; the handler lives at /api/version
  // because an `_`-prefixed app folder is private in the App Router.
  async rewrites() {
    return [{ source: '/__version', destination: '/api/version' }];
  },
};

export default nextConfig;
