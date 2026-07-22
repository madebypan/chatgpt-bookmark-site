import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/oauth/metadata/protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/mcp",
        destination: "/oauth/metadata/protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/oauth/metadata/authorization-server",
      },
    ];
  },
};

export default nextConfig;
