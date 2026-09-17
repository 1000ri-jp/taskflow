import { Loader2 } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

export function AsyncState({ state, message, onRetry }: {
  state: 'loading' | 'empty' | 'error'; message: string; onRetry?: () => void;
}) {
  return <div role={state === 'error' ? 'alert' : 'status'} className={cn('flex flex-wrap items-center justify-center gap-2 p-4 text-sm', state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
    {state === 'loading' && <Loader2 className="size-4 animate-spin" aria-hidden />}<span className="min-w-0 break-words">{message}</span>
    {state === 'error' && onRetry && <Button type="button" variant="ghost" size="sm" onClick={onRetry}>再取得</Button>}
  </div>;
}
