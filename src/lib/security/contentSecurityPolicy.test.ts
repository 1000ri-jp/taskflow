import { buildContentSecurityPolicy } from './contentSecurityPolicy';

describe('buildContentSecurityPolicy', () => {
  it('allows Firebase Storage assets to be embedded in frames', () => {
    const policy = buildContentSecurityPolicy();

    expect(policy).toContain(
      "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://firebasestorage.googleapis.com"
    );
  });
});
