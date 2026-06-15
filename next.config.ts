import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The creator access gate (/get-access) uploads follow-proof screenshots
    // through a Server Action, which defaults to a 1MB body cap — a single
    // phone screenshot easily exceeds that and 500s. Raise it to cover the
    // action's own limit (up to 3 images × 10MB) so its friendly per-file
    // validation governs instead. (Fan gates upload via an API route, which
    // has no such cap.)
    serverActions: {
      bodySizeLimit: "32mb",
    },
  },
};

export default nextConfig;
