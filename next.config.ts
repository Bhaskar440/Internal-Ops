import type { NextConfig } from "next";

/**
 * Security headers (§63).
 *
 * These defend the browser side of the app: clickjacking, MIME sniffing,
 * referrer leakage and unwanted device access. HSTS is included because the
 * spec requires HTTPS-only in production; it is harmless on localhost, where
 * browsers ignore it for plain HTTP.
 */
const securityHeaders = [
  // No framing at all — this app is never embedded, so denying outright is
  // stronger than SAMEORIGIN and closes clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send the origin to other sites, the full path only to ourselves, so a
  // referrer never leaks a person or payroll id to a third party.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here needs a camera, microphone or location.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
