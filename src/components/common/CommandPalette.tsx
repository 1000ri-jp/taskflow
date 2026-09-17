'use client';

import { useEffect, useRef, useState, useCallback, useMemo, useId } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AsyncState } from '@/components/ui/async-state';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { useGlobalSearch, type SearchResult } from '@/hooks/useGlobalSearch';
import {
  Search,
  FolderKanban,
  CheckSquare,
  Plus,
  LayoutDashboard,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const {
    isCommandPaletteOpen,
    closeCommandPalette,
    openProjectModal,
  } = useUIStore();
  const {
    query,
    setQuery,
    projectResults,
    taskResults,
    isSearching,
    error,
    retry,
  } = useGlobalSearch();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Quick actions shown when no query
  const quickActions: QuickAction[] = useMemo(
    () => [
      {
        id: 'dashboard',
        label: 'ダッシュボードを開く',
        icon: <LayoutDashboard className="h-4 w-4" />,
        action: () => {
          router.push('/');
          closeCommandPalette();
        },
      },
      {
        id: 'new-project',
        label: '新しいプロジェクトを作成',
        icon: <Plus className="h-4 w-4" />,
        action: () => {
          closeCommandPalette();
          openProjectModal();
        },
      },
    ],
    [closeCommandPalette, openProjectModal, router]
  );

  // Build flat list of selectable items
  const allItems: Array<{ type: 'action' | 'project' | 'task'; data: QuickAction | SearchResult }> = useMemo(
    () =>
      query.trim()
        ? [
            ...projectResults.map((r) => ({ type: 'project' as const, data: r })),
            ...taskResults.slice(0, 20).map((r) => ({ type: 'task' as const, data: r })),
          ]
        : quickActions.map((a) => ({ type: 'action' as const, data: a })),
    [projectResults, query, quickActions, taskResults]
  );

  // Reset selection when results change
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedIndex(0);
    });
  }, [query, projectResults.length, taskResults.length]);

  // Clear query when palette closes
  useEffect(() => {
    if (!isCommandPaletteOpen) {
      queueMicrotask(() => {
        setQuery('');
        setSelectedIndex(0);
      });
    }
  }, [isCommandPaletteOpen, setQuery]);

  // Focus input when opened
  useEffect(() => {
    if (isCommandPaletteOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isCommandPaletteOpen]);

  const handleSelect = useCallback(
    (index: number) => {
      const item = allItems[index];
      if (!item) return;

      if (item.type === 'action') {
        (item.data as QuickAction).action();
      } else if (item.type === 'project') {
        const result = item.data as SearchResult;
        router.push(`/projects/${result.projectId}/board`);
        closeCommandPalette();
      } else if (item.type === 'task') {
        const result = item.data as SearchResult;
        router.push(`/projects/${result.projectId}/board?task=${result.id}`);
        closeCommandPalette();
      }
    },
    [allItems, router, closeCommandPalette]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < allItems.length - 1 ? prev + 1 : 0
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : Math.max(0, allItems.length - 1)
          );
          break;
        case 'Enter':
          e.preventDefault();
          handleSelect(selectedIndex);
          break;
      }
    },
    [allItems.length, selectedIndex, handleSelect]
  );

  // Scroll selected item into view
  useEffect(() => {
    const el = inputRef.current?.closest('[role="dialog"]')?.querySelector(`[data-command-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const priorityLabel = (priority: string | null | undefined) => {
    switch (priority) {
      case 'high':
        return <Badge variant="destructive" className="text-[10px] px-1 py-0">高</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="text-[10px] px-1 py-0">中</Badge>;
      case 'low':
        return <Badge variant="outline" className="text-[10px] px-1 py-0">低</Badge>;
      default:
        return null;
    }
  };

  return (
    <Dialog open={isCommandPaletteOpen} onOpenChange={(open) => !open && closeCommandPalette()}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 p-0 sm:max-w-xl gap-0"
      >
        <DialogTitle className="sr-only">タスク・プロジェクトを検索</DialogTitle>
        <DialogDescription className="sr-only">名前や説明の言葉を入力して、仕事を開けます。</DialogDescription>
        {/* Search input */}
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            role="combobox"
            aria-label="プロジェクトやタスクを検索"
            aria-autocomplete="list"
            aria-expanded={isCommandPaletteOpen}
            aria-controls={listId}
            aria-activedescendant={allItems[selectedIndex] ? `${listId}-${selectedIndex}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="プロジェクトやタスクを検索..."
            className="flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          {isSearching && (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          )}
          <kbd className="ml-2 shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {query.trim() && error && <AsyncState state="error" message={error} onRetry={retry} />}
        {/* Results */}
        <ScrollArea className="max-h-[300px] overflow-y-auto">
          <div id={listId} role="listbox" aria-label="検索候補" aria-busy={isSearching} className="p-2">
            {/* No query: show quick actions */}
            {!query.trim() && (
              <div>
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  クイックアクション
                </div>
                {quickActions.map((action, index) => (
                  <button
                    key={action.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={selectedIndex === index}
                    tabIndex={-1}
                    data-command-index={index}
                    onClick={() => handleSelect(index)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm',
                      selectedIndex === index
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground'
                    )}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                    <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            {/* Search results */}
            {query.trim() && (
              <>
                {/* Project results */}
                {projectResults.length > 0 && (
                  <div>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      プロジェクト
                    </div>
                    {projectResults.map((result, i) => {
                      const index = i;
                      return (
                        <button
                          key={`project-${result.id}`}
                          id={`${listId}-${index}`}
                          role="option"
                          aria-selected={selectedIndex === index}
                          tabIndex={-1}
                          data-command-index={index}
                          onClick={() => handleSelect(index)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm',
                            selectedIndex === index
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground'
                          )}
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded text-xs">
                            {result.projectIcon}
                          </span>
                          <span className="truncate font-medium">{result.title}</span>
                          {result.description && (
                            <span className="truncate text-xs text-muted-foreground">
                              {result.description}
                            </span>
                          )}
                          <FolderKanban className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Task results */}
                {taskResults.length > 0 && (
                  <div>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      タスク ({taskResults.length > 20 ? '20+' : taskResults.length})
                    </div>
                    {taskResults.slice(0, 20).map((result, i) => {
                      const index = projectResults.length + i;
                      return (
                        <button
                          key={`task-${result.id}`}
                          id={`${listId}-${index}`}
                          role="option"
                          aria-selected={selectedIndex === index}
                          tabIndex={-1}
                          data-command-index={index}
                          onClick={() => handleSelect(index)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm',
                            selectedIndex === index
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground'
                          )}
                        >
                          <CheckSquare
                            className={cn(
                              'h-4 w-4 shrink-0',
                              result.isCompleted ? 'text-green-500' : 'text-muted-foreground'
                            )}
                          />
                          <span
                            className={cn(
                              'truncate',
                              result.isCompleted && 'line-through text-muted-foreground'
                            )}
                          >
                            {result.title}
                          </span>
                          {priorityLabel(result.priority)}
                          <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                            <span>{result.projectIcon}</span>
                            <span className="max-w-[100px] truncate">{result.projectName}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* No results */}
                {!isSearching && !error && projectResults.length === 0 && taskResults.length === 0 && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    検索結果が見つかりませんでした
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t px-3 py-2 text-[10px] text-muted-foreground">
          <div className="flex gap-2">
            <span>
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">↑↓</kbd> 移動
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">↵</kbd> 決定
            </span>
          </div>
          <span>
            <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">⌘K</kbd> で開く
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
