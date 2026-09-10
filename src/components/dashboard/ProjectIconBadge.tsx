'use client';

import { cn } from '@/lib/utils';
import type { Priority } from '@/types';

export const PROJECT_BADGE_CLASS_NAME = 'h-5 min-w-10 rounded px-1.5 text-[10px] font-bold leading-none';

const priorityColors: Record<Priority, string> = { high: '#b91c1c', medium: '#a16207', low: '#475569' };

export function ProjectIconBadge({ icon, iconUrl, color, priority, fallback = 'TF', className }: { icon?: string; iconUrl?: string; color?: string; priority?: Priority | null; fallback?: string; className?: string }) {
  void iconUrl;
  void color;
  return <span className={cn('inline-flex w-fit shrink-0 items-center justify-self-start justify-center overflow-hidden bg-neutral-900 text-white', PROJECT_BADGE_CLASS_NAME, className)} style={{ backgroundColor: priority ? priorityColors[priority] : '#1f1f1f' }}>
    {icon || fallback}
  </span>;
}
