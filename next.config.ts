// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // let production builds pass even with lint errors
  },
};

export default nextConfig;
