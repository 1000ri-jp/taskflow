import { readStampSettings, saveStampSettings } from '@/lib/comments/repository';
import { reactionBody, reactionFailure, reactionJson, reactionUser } from '@/lib/comments/routeSupport';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { return reactionJson(await readStampSettings(await reactionUser(request))); }
  catch (error) { return reactionFailure(error); }
}
export async function PUT(request: Request) {
  try { return reactionJson(await saveStampSettings(await reactionUser(request), await reactionBody(request))); }
  catch (error) { return reactionFailure(error); }
}
