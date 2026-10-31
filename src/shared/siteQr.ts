// Shape of a rotating site QR token (see src/server/auth/siteQr.ts): version, site code, issue
// second in base 36, nonce, signature. Shared by the API schema and the in-app scanner.
export const SITE_QR_TOKEN_RE = /^1\.[A-Z0-9_-]{2,10}\.[0-9a-z]{1,10}\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{16}$/;
