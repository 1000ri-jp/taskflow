import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OAuth callbacks contain a short-lived authorization code; keep it out of dev logs.
  logging: { incomingRequests: { ignore: [/^\/api\/google\/callback(?:\?|$)/] } },
  // Keep the real-data local server isolated from the mock secretary preview
  // when both are opened from this checkout.
  ...(process.env.NEXT_DEV_DIST_DIR ? { distDir: process.env.NEXT_DEV_DIST_DIR } : {}),
  env: {
    BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
    BROWSERSLIST_IGNORE_OLD_DATA: "true",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.googleusercontent.com https://*.googleapis.com https://firebasestorage.googleapis.com",
              "font-src 'self'",
              "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.cloudfunctions.net wss://*.firebaseio.com https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://firebasestorage.googleapis.com",
              "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
      {
        // Only fictitious UI specimens may be embedded, and only on this origin.
        source: "/ui-guide/preview",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;
