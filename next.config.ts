import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        // allow embedding your app inside Notion
        { key: "Content-Security-Policy", value: "frame-ancestors https://www.notion.so https://*.notion.site;" }
      ]
    }
  ]
};

export default nextConfig;
