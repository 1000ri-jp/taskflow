'use client';

import type { ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ControlHint({ label, description, children }: {
  label: string;
  description?: string;
  children: ReactElement;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-64 text-left leading-relaxed">
        <p className="font-medium">{label}</p>
        {description && <p className="mt-0.5 opacity-90">{description}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
