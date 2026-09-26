'use client';

import type { ComponentProps } from 'react';
import { X } from 'lucide-react';
import { PopoverClose, PopoverContent } from '@/components/ui/popover';

export const companionPopoverContentClassName = 'w-[32rem] max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] space-y-4 overflow-y-auto';

export function CompanionPopoverContent({ className, ...props }: ComponentProps<typeof PopoverContent>) {
  return <PopoverContent
    side="top"
    align="start"
    collisionPadding={16}
    className={[companionPopoverContentClassName, className].filter(Boolean).join(' ')}
    {...props}
  >
    <PopoverClose asChild>
      <button type="button" aria-label="Close" className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <X className="size-4" aria-hidden="true" />
      </button>
    </PopoverClose>
    {props.children}
  </PopoverContent>;
}
