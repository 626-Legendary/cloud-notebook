/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async redirects() {
    return [{ source: "/favicon.ico", destination: "/icon.png", permanent: false }];
  },
  images: { unoptimized: true },
  experimental: { cpus: 1 },
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] }
};

export default nextConfig;
