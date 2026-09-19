import { readReactions, setReaction } from '@/lib/comments/repository';
import { reactionBody, reactionFailure, reactionJson, reactionUser } from '@/lib/comments/routeSupport';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const uid = await reactionUser(request);
    const query = new URL(request.url).searchParams;
    return reactionJson(await readReactions(uid, { projectId: query.get('projectId') ?? '', taskId: query.get('taskId') ?? '' }, query.getAll('commentId')));
  } catch (error) { return reactionFailure(error); }
}
export async function PUT(request: Request) {
  try { return reactionJson({ reaction: await setReaction(await reactionUser(request), await reactionBody(request)) }); }
  catch (error) { return reactionFailure(error); }
}
