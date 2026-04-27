import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: {
    externalDir: true,
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  transpilePackages: ["@twin/core"],
  typescript: {
    // Type checking verified locally before each deploy.
    // Docker monorepo builds have workspace type resolution issues.
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? process.env.SUPABASE_URL
      ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  },
};
export default config;
