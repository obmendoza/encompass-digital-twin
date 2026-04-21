import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: { externalDir: true },
  transpilePackages: ["@twin/core"],
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? process.env.SUPABASE_URL
      ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  },
};
export default config;
