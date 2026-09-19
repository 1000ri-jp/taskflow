import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function PageHeading({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 className={cn('tf-page-heading', className)} {...props} />;
}
export function Prose({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('tf-body whitespace-pre-wrap', className)} {...props} />;
}
export function HelpText({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('tf-help', className)} {...props} />;
}
