import type { NextConfig } from "next";

// sharp's native addon (@img/sharp-linux-x64) dynamically links against
// libvips-cpp.so, which ships in the separate @img/sharp-libvips-linux-x64
// package. With pnpm's symlinked store, Next's file tracer copies sharp.node
// into the serverless bundle but misses the sibling .so, so `require('sharp')`
// fails at runtime with ERR_DLOPEN_FAILED. Force-include the full @img native
// tree into every route that touches sharp (proof verification + cover-art
// palette extraction).
const sharpNativeFiles = [
  "./node_modules/.pnpm/@img+*/node_modules/@img/**/*",
  "./node_modules/@img/**/*",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/submissions/[id]/proofs": sharpNativeFiles,
    "/dashboard/gates/new": sharpNativeFiles,
    "/dashboard/gates/new/*": sharpNativeFiles,
    // Catch-all safety net so any other route that imports sharp keeps the
    // native binaries.
    "/*": sharpNativeFiles,
    "/**": sharpNativeFiles,
  },
};

export default nextConfig;
