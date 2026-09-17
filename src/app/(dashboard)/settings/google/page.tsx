import { Suspense } from 'react';
import { GoogleWorkspaceSettings } from '@/components/google/GoogleWorkspacePanel';
export default function GoogleSettingsPage() {
  return <Suspense fallback={<p>Google連携を読み込んでいます…</p>}><GoogleWorkspaceSettings /></Suspense>;
}
