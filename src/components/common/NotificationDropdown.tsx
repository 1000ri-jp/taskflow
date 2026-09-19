'use client';

import { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationList } from './NotificationList';

export function NotificationDropdown() {
  const { notifications, unreadCount, isLoading, error, markAllAsRead } =
    useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener('taskflow-open-notifications', open);
    return () => window.removeEventListener('taskflow-open-notifications', open);
  }, []);

  const attentionCount = notifications.filter(n => !n.isRead || n.data?.requiresResponse === true).length;
  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {attentionCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-medium text-white">
              {attentionCount > 9 ? '9+' : attentionCount}
            </span>
          )}
          <span className="sr-only">通知</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>通知</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.preventDefault();
                markAllAsRead();
              }}
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              すべて既読
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <ScrollArea className={!isLoading && !error && notifications.length > 0 ? "h-[300px]" : undefined}>
          <NotificationList asMenu />
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
