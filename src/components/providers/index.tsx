'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AuthProvider } from './AuthProvider';
import { QueryProvider } from './QueryProvider';
import { initializeFirestore } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { AppearanceProvider } from './AppearanceProvider';
import { TaskAutomationRunner } from '@/components/task/TaskAutomationRunner';
import { AutoArchiveRunner } from '@/components/board/AutoArchiveRunner';

interface ProvidersProps {
  children: ReactNode;
}

function BusinessProviders({ children }: ProvidersProps) {
  // Initialize Firestore on mount
  useEffect(() => {
    if (isE2EMockAuthEnabled()) {
      return;
    }
    initializeFirestore().catch(console.error);
  }, []);

  return (
    <AppearanceProvider><QueryProvider>
      <AuthProvider><TaskAutomationRunner /><AutoArchiveRunner />{children}</AuthProvider>
    </QueryProvider></AppearanceProvider>
  );
}

// The guide must never mount auth subscriptions, task automation or auto-archive.
// Appearance remains shared, so specimens match the actual screen theme.
export function Providers({ children }: ProvidersProps) {
  const pathname = usePathname();
  if (pathname === '/ui-guide' || pathname?.startsWith('/ui-guide/')) {
    return <AppearanceProvider>{children}</AppearanceProvider>;
  }
  return <BusinessProviders>{children}</BusinessProviders>;
}
