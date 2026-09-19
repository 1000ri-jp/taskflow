import { customStampForm, uploadCustomStamp } from '@/lib/comments/customStamps';
import { removeCustomStamp } from '@/lib/comments/repository';
import { reactionBody, reactionFailure, reactionJson, reactionUser } from '@/lib/comments/routeSupport';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const uid = await reactionUser(request);
    return reactionJson(await uploadCustomStamp(uid, await customStampForm(request)));
  } catch (error) { return reactionFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const uid = await reactionUser(request);
    return reactionJson(await removeCustomStamp(uid, await reactionBody(request)));
  } catch (error) { return reactionFailure(error); }
}
