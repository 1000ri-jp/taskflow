import type { Metadata } from 'next';
import { GuidePreview, type PreviewOptions } from '@/components/ui-guide/GuidePreview';

export const metadata: Metadata = { title: 'TaskFlow UIガイドの操作見本', robots: { index: false, follow: false } };

export default async function PreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const value = (key: string) => typeof q[key] === 'string' ? q[key] as string : '';
  const bounded = (key: string, min: number, max: number) => value(key) && Number.isFinite(Number(value(key))) ? Math.max(min, Math.min(max, Number(value(key)))) : undefined;
  const fetchState = ['loading','empty','error'].includes(value('fetchState')) ? value('fetchState') as PreviewOptions['fetchState'] : 'ready';
  return <GuidePreview key={JSON.stringify(q)} sample={value('sample') || 'outline'} long={value('long') === 'true'} many={value('many') === 'true'}
    disabled={value('disabled') === 'true'} selected={value('selected') === 'true'} fetchState={fetchState} variant={value('variant')}
    rowSpace={bounded('rowSpace',4,12)} cardSpace={bounded('cardSpace',8,24)} bubbleSpace={bounded('bubbleSpace',8,32)} buttonHeight={bounded('buttonHeight',28,36)} />;
}
