import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, finishGoogleOAuth } from '@/lib/google/workspace/oauth';
import { googleConfig, GoogleWorkspaceError } from '@/lib/google/workspace/security';
import { googleFailure } from '@/lib/google/workspace/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = googleConfig().origin; } catch (e) { return googleFailure(e); }
  const result = new URL('/settings/google', origin);
  try {
    if (request.nextUrl.searchParams.has('error')) throw new GoogleWorkspaceError('CANCELLED', '接続はキャンセルされました。');
    const service = await finishGoogleOAuth(request.cookies.get(COOKIE_NAME)?.value ?? '', request.nextUrl.searchParams.get('state') ?? '', request.nextUrl.searchParams.get('code') ?? '');
    result.searchParams.set('connected', service);
  } catch (e) { result.searchParams.set('google_error', e instanceof GoogleWorkspaceError ? e.code : 'UNAVAILABLE'); }
  const response = NextResponse.redirect(result, 303);
  response.headers.set('Cache-Control', 'no-store'); response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(COOKIE_NAME, '', { path: '/api/google', maxAge: 0, httpOnly: true, sameSite: 'lax' });
  return response;
}
