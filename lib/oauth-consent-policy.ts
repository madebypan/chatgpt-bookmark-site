export const OAUTH_REDIRECT_FORM_ACTION_SOURCES = [
  "'self'",
  "http://127.0.0.1:*",
  "http://localhost:*",
  "http://[::1]:*",
  "https://chatgpt.com",
  "https://claude.ai",
] as const;

export const OAUTH_CONSENT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  // Cloudflare injects a per-request verification bootstrap into this small
  // consent document, so a fixed script hash expires immediately.
  "script-src 'self' 'unsafe-inline'",
  "frame-src 'self'",
  "connect-src 'self'",
  "style-src 'unsafe-inline'",
  `form-action ${OAUTH_REDIRECT_FORM_ACTION_SOURCES.join(" ")}`,
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");
