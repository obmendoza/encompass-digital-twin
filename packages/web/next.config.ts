import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: { externalDir: true },
  transpilePackages: ["@twin/core"],
};
export default config;
