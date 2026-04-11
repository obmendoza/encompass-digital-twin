import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: { externalDir: true },
  transpilePackages: ["@twin/core"],
  env: { TWIN_API_URL: process.env.TWIN_API_URL ?? "http://127.0.0.1:4000" },
};
export default config;
