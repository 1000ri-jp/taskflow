'use client';

import Link from 'next/link';
import { BookOpen, Menu, Search, User, Settings, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/stores/uiStore';
import { AppearanceSwitcher } from './AppearanceSwitcher';
import { dashboardHref, useDashboardViewStore } from '@/stores/dashboardViewStore';

export function Header() {
  const { user, signOut } = useAuth();
  const { toggleSidebar, openCommandPalette, isSidebarOpen } = useUIStore();
  const dashboardView = useDashboardViewStore(state => state.view);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="tf-header sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className={isSidebarOpen ? 'lg:hidden' : ''}
        onClick={toggleSidebar}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle sidebar</span>
      </Button>

      <Link href={dashboardHref(dashboardView)} className="tf-brand flex items-center gap-2 hover:opacity-80 transition-opacity">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          TF
        </div>
        <span className="hidden font-semibold md:inline-block">TaskSlowth</span>
      </Link>

      <div className="hidden min-w-0 flex-1 sm:flex sm:justify-end">
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:bg-accent"
        >
          <Search className="h-4 w-4" />
          <span>検索...</span>
          <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          onClick={openCommandPalette}
          title="検索"
        >
          <Search className="h-5 w-5" />
          <span className="sr-only">検索</span>
        </Button>
        <AppearanceSwitcher />
        <Button asChild variant="ghost" size="icon" className="-ml-1 mr-2" title="操作説明" aria-label="操作説明">
          <Link href="/help">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user?.photoURL || ''} alt={user?.displayName || ''} />
                <AvatarFallback>
                  {user?.displayName ? getInitials(user.displayName) : 'U'}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {user?.displayName}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" className="flex items-center">
                <User className="mr-2 h-4 w-4" />
                プロフィール
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="flex items-center">
                <Settings className="mr-2 h-4 w-4" />
                設定
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              ログアウト
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
