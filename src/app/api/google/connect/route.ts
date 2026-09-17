import { NextRequest } from 'next/server';
import { googleBody, googleFailure, googleResponse, googleService, googleUser } from '@/lib/google/workspace/http';
import { COOKIE_NAME, startGoogleOAuth } from '@/lib/google/workspace/oauth';
import { googleConfig, GoogleWorkspaceError } from '@/lib/google/workspace/security';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const { uid, email } = await googleUser(request); const service = googleService((await googleBody(request)).service); const config = googleConfig();
    if (request.headers.get('origin') !== config.origin) throw new GoogleWorkspaceError('ORIGIN', '設定されたTaskFlowのURLから接続してください。', 403);
    const result = await startGoogleOAuth(uid, email, service);
    const response = googleResponse({ url: result.url });
    response.cookies.set(COOKIE_NAME, result.cookie, { httpOnly: true, sameSite: 'lax', secure: config.secure, path: '/api/google', maxAge: 600 });
    return response;
  } catch (e) { return googleFailure(e); }
}
