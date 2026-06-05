import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // serialport uses native Node.js bindings — must not be bundled by Turbopack
  serverExternalPackages: ['serialport', '@serialport/bindings-cpp'],
};

export default nextConfig;
