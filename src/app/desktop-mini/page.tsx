import type { Metadata } from 'next';
import { DesktopMiniApp } from '@/components/desktop/DesktopMiniApp';

export const metadata: Metadata = {
  title: 'TaskSlowth Mini',
};

export default function DesktopMiniPage() {
  return <DesktopMiniApp />;
}
