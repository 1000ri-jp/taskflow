import type { Metadata } from 'next';
import { DesktopMiniConnect } from '@/components/desktop/DesktopMiniConnect';

export const metadata: Metadata = { title: 'TaskSlowth Miniと接続', referrer: 'no-referrer' };
export default function DesktopMiniConnectPage() { return <DesktopMiniConnect />; }
