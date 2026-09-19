'use client';

import Image from 'next/image';
import { FolderKanban } from 'lucide-react';
import { ControlHint } from '@/components/ui/control-hint';
import { cn } from '@/lib/utils';

export function ProjectMark({ name, icon, iconUrl, color, size = 'small' }: {
  name: string;
  icon?: string;
  iconUrl?: string;
  color?: string;
  size?: 'small' | 'large';
}) {
  return (
    <ControlHint label={name}>
      <span
        role="img"
        aria-label={name}
        tabIndex={0}
        className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted leading-none text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', size === 'large' ? 'h-8 w-8 text-xl' : 'h-6 w-6 text-sm')}
        style={color ? { backgroundColor: `${color}20`, color } : undefined}
      >
        {iconUrl ? <Image src={iconUrl} alt="" width={size === 'large' ? 32 : 24} height={size === 'large' ? 32 : 24} className="h-full w-full object-cover" />
          : icon ? <span aria-hidden="true">{icon}</span>
            : <FolderKanban className={size === 'large' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />}
      </span>
    </ControlHint>
  );
}
