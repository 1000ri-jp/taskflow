import { NextRequest } from 'next/server';
import { googleFailure, googleResponse, googleUser } from '@/lib/google/workspace/http';
import { parseCalendarRange, readCalendarRange } from '@/lib/google/workspace/calendar-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  try {
    const { uid } = await googleUser(request);
    const range = parseCalendarRange(request.nextUrl.searchParams.get('start'), request.nextUrl.searchParams.get('end'));
    return googleResponse(await readCalendarRange(uid, range, request.nextUrl.searchParams.get('refresh') === '1'));
  } catch (error) { return googleFailure(error); }
}
