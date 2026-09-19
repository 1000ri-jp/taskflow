export const CONTENT_SECURITY_POLICY_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.googleapis.com https://firebasestorage.googleapis.com",
  "font-src 'self'",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.cloudfunctions.net wss://*.firebaseio.com https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://firebasestorage.googleapis.com",
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://firebasestorage.googleapis.com",
  "object-src 'none'",
  "base-uri 'self'",
] as const;

export function buildContentSecurityPolicy(): string {
  return CONTENT_SECURITY_POLICY_DIRECTIVES.join('; ');
}
