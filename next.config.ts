import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['mammoth', 'unpdf', 'mysql2'],
};

export default nextConfig;
