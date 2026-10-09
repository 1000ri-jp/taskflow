import { notFound } from 'next/navigation';
import { oidcConfig } from '@/lib/mcp/oidc';
import Consent from './consent';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'ChatGPTとの接続確認 | Slowth', referrer: 'no-referrer' };
export default async function Page({ searchParams }: { searchParams: Promise<{ interaction?: string }> }) {
  try { oidcConfig(); } catch { notFound(); }
  const { interaction } = await searchParams;
  if (!interaction || !/^[A-Za-z0-9_-]{1,128}$/.test(interaction)) notFound();
  return <Consent interaction={interaction} />;
}
