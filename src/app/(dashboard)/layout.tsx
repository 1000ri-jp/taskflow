'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Header } from '@/components/common/Header';
import { Sidebar } from '@/components/common/Sidebar';
import { ProjectFormModal } from '@/components/project/ProjectFormModal';
import { ShortcutHelpModal } from '@/components/ShortcutHelpModal';
import { Loader2 } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { useHotkeys } from '@/hooks/useHotkeys';
import { CompanionAI } from '@/components/ai/CompanionAI';
import { CommandPalette } from '@/components/common/CommandPalette';
import { UndoToast } from '@/components/common/UndoToast';
import { useUndoStore } from '@/stores/undoStore';
import { useDashboardViewStore } from '@/stores/dashboardViewStore';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuth();
  const { openProjectModal, openCommandPalette, setSidebarOpen } = useUIStore();
  const { undo: performUndo, redo: performRedo } = useUndoStore();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const { hydrated: dashboardHydrated, hydrate: hydrateDashboard } = useDashboardViewStore();
  useEffect(() => { if (!dashboardHydrated) hydrateDashboard(); }, [dashboardHydrated, hydrateDashboard]);
  useEffect(() => { if (window.matchMedia('(max-width: 1023px)').matches) setSidebarOpen(false); }, [setSidebarOpen]);

  // Extract projectId from pathname if on a project page
  const currentProjectId = useMemo(() => {
    const match = pathname?.match(/\/projects\/([^/]+)/);
    return match ? match[1] : null;
  }, [pathname]);

  // Hotkey callbacks
  const handleNewTask = useCallback(() => {
    // Focus on the first "Add task" input if on board page
    if (pathname?.includes('/board')) {
      const addTaskInput = document.querySelector('[data-testid="board-view"] input[placeholder*="タスク"]') as HTMLInputElement;
      if (addTaskInput) {
        addTaskInput.focus();
        return;
      }
    }
    // Otherwise open project modal for quick access
    openProjectModal();
  }, [pathname, openProjectModal]);

  const handleSearch = useCallback(() => {
    // Focus on search input in header
    const searchInput = document.querySelector('input[placeholder*="検索"]') as HTMLInputElement;
    if (searchInput) {
      searchInput.focus();
    }
  }, []);

  const handleEscape = useCallback(() => {
    setIsHelpOpen(false);
    // Also blur any focused element
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  const handleShowHelp = useCallback(() => {
    setIsHelpOpen(true);
  }, []);

  const handleCommandPalette = useCallback(() => {
    openCommandPalette();
  }, [openCommandPalette]);

  const handleUndo = useCallback(() => {
    performUndo();
  }, [performUndo]);

  const handleRedo = useCallback(() => {
    performRedo();
  }, [performRedo]);

  // Register hotkeys
  const hotkeys = useMemo(
    () => [
      { key: 'k', callback: handleCommandPalette, metaKey: true },
      { key: 'k', callback: handleCommandPalette, ctrlKey: true },
      { key: 'z', callback: handleUndo, metaKey: true },
      { key: 'z', callback: handleUndo, ctrlKey: true },
      { key: 'z', callback: handleRedo, metaKey: true, shiftKey: true },
      { key: 'z', callback: handleRedo, ctrlKey: true, shiftKey: true },
      { key: 'n', callback: handleNewTask },
      { key: 'Escape', callback: handleEscape },
      { key: '/', callback: handleSearch },
      { key: '?', callback: handleShowHelp, shiftKey: true },
    ],
    [handleCommandPalette, handleUndo, handleRedo, handleNewTask, handleEscape, handleSearch, handleShowHelp]
  );

  useHotkeys(hotkeys);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <NotificationProvider>
      <div className="flex h-screen min-w-[320px] flex-col overflow-hidden">
        <Header />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main
            className={cn(
              'tf-main flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-gray-50 p-4 lg:ml-0 lg:p-6'
            )}
          >
            {children}
          </main>
        </div>
        <ProjectFormModal />
        <ShortcutHelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
        <CommandPalette />
        <UndoToast />
        <CompanionAI projectId={currentProjectId} autoGreeting={pathname !== '/neo'} quickCheckEnabled={Boolean(pathname) && pathname !== '/neo'} />
      </div>
    </NotificationProvider>
  );
}
