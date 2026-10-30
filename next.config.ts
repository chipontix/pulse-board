import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["ioredis", "pg"],
};

export default config;
