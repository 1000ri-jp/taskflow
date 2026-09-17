import { NextResponse } from 'next/server';
import { getAnthropicTools, getOpenAITools, getToolDefinitions } from '@/lib/ai/tools';

export async function GET() {
  if (process.env.NODE_ENV !== 'development') return new NextResponse(null, {status:404});
  const allTools = getToolDefinitions({ projectId: 'all' });
  const anthropicTools = getAnthropicTools({ projectId: 'all' });
  const openAITools = getOpenAITools({ projectId: 'all' });

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    totalTools: allTools.length,
    toolNames: allTools.map(t => t.name),
    anthropicFormat: anthropicTools.map(t => ({ name: t.name, description: t.description.substring(0, 50) })),
    openAIFormat: openAITools.map(t => ({ name: t.function.name })),
  });
}
