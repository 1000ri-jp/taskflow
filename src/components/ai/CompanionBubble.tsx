'use client';
import type { ComponentProps } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './CompanionLauncher.module.css';

/** Position and notification policy remain with the launcher. This is the shared visible surface. */
export function CompanionBubble({ className, variant = 'notice', ...props }: ComponentProps<'div'> & { variant?: 'notice' | 'greeting' | 'quick-check' }) {
  return <div data-bubble-variant={variant} className={cn(styles.callout, 'overflow-y-auto rounded-2xl border-2 border-amber-400 bg-popover text-popover-foreground', variant === 'greeting' && 'p-4', className)} {...props} />;
}
export function GreetingContent({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return <>
    <div className="mb-2 flex items-center gap-2"><span className="min-w-0 flex-1 text-sm font-semibold text-amber-900 dark:text-amber-200">モアイ</span>
      <button type="button" onClick={onDismiss} aria-label="声かけを閉じる" title="声かけを閉じる" className="-mr-1 -mt-1 rounded-lg p-1 text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><X className="h-3.5 w-3.5" aria-hidden /></button>
    </div>
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message}</p>
    <button type="button" onClick={onDismiss} className="mt-3 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-ring"><Check className="h-3.5 w-3.5" aria-hidden />みたよ</button>
  </>;
}
