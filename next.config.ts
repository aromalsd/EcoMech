import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Pin the workspace root so a lockfile further up the tree is not picked up.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
