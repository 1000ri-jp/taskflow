import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function SettingsLayout({ className, align = 'center', ...props }: ComponentProps<'div'> & { align?: 'center' | 'start' }) {
  return <div data-ui-pattern="settings" className={cn('tf-settings-layout min-w-0 max-w-2xl', align === 'center' && 'mx-auto', className)} {...props} />;
}
export function DetailFrame({ className, ...props }: ComponentProps<'div'>) {
  return <div data-ui-pattern="detail" className={cn('flex h-[90vh] min-h-0 flex-col', className)} {...props} />;
}
export function DetailBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', className)} {...props} />;
}
export const detailHeader = 'tf-detail-header shrink-0 border-b';
export const detailContent = 'tf-detail-content space-y-1';
export const detailDialog = 'flex max-h-[90vh] flex-col gap-0 overflow-clip p-0 sm:max-w-[min(896px,calc(100vw-2rem))]';
