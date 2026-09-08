'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

export const PROJECT_BADGE_CLASS_NAME = 'h-5 min-w-10 rounded px-1.5 text-[10px] font-bold leading-none';

export function ProjectIconBadge({ icon, iconUrl, color, fallback = 'TF', className }: { icon?: string; iconUrl?: string; color?: string; fallback?: string; className?: string }) {
  const hasProjectIcon = Boolean(icon || iconUrl);
  return <span className={cn('inline-flex w-fit shrink-0 items-center justify-self-start justify-center overflow-hidden', PROJECT_BADGE_CLASS_NAME, (!hasProjectIcon || !color) && 'bg-neutral-900 text-white', className)} style={hasProjectIcon && color ? { backgroundColor: color, color: '#fff' } : undefined}>
    {icon ? icon : iconUrl ? <Image src={iconUrl} alt="" width={20} height={20} unoptimized className="h-5 w-5 object-cover" /> : fallback}
  </span>;
}
