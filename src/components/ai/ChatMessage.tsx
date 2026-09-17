'use client';

import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AIMessage } from '@/types/ai';
import { cn } from '@/lib/utils';
import { User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthStore } from '@/stores/authStore';
import styles from './ChatMessage.module.css';
import { CopyableCodeBlock } from './CopyableCodeBlock';
import { CompanionAvatar } from './CompanionAvatar';

interface ChatMessageProps {
  message: AIMessage;
  isStreaming?: boolean;
}

const markdownComponents: Components = {
  pre: ({children}) => <CopyableCodeBlock>{children}</CopyableCodeBlock>,
  table: ({ children }) => (
    <div className={styles.tableScroll} role="region" aria-label="表（横にスクロールできます）" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) => href ? (
    <a href={href} target={/^(?:https?:)?\/\//i.test(href) ? '_blank' : undefined} rel="noopener noreferrer">{children}</a>
  ) : <span>{children}</span>,
  // AI output must not fetch remote images just by displaying a reply.
  img: ({ src, alt }) => typeof src === 'string' && src ? (
    <a href={src} target="_blank" rel="noopener noreferrer">{alt || '画像を開く'}</a>
  ) : <span>{alt}</span>,
};

const FormattedReply = memo(function FormattedReply({ content }: { content: string }) {
  return <div className={styles.markdown}>
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>{content}</Markdown>
  </div>;
});

export function ChatMessage({ message, isStreaming = false }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const photoURL = useAuthStore(state => state.user?.photoURL);

  return (
    <div className={cn('flex min-w-0 items-start gap-2.5 px-3 py-3 sm:px-5', isUser && 'flex-row-reverse')}>
      <div className={cn('mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', isUser ? 'bg-primary text-primary-foreground' : 'bg-muted')} aria-hidden="true">
        {isUser ? <Avatar className="h-8 w-8">
          <AvatarImage src={photoURL || ''} alt="" className="object-cover" />
          <AvatarFallback className="bg-primary text-primary-foreground"><User className="h-4 w-4" /></AvatarFallback>
        </Avatar> : <CompanionAvatar />}
      </div>
      <div className={cn('flex min-w-0 max-w-[calc(100%_-_2.625rem)] flex-col gap-1.5 sm:max-w-[88%]', isUser ? 'items-end' : 'items-start')}>
        <div className={cn('px-1 text-xs font-medium text-muted-foreground', isUser && 'text-right')}>{isUser ? 'あなた' : 'モアイ（AIアシスタント）'}</div>
        <div className={cn('min-w-0 max-w-full rounded-2xl border px-3.5 text-left text-foreground shadow-sm', isUser ? 'rounded-tr-sm border-primary/15 bg-primary/10 py-1.5' : 'rounded-tl-sm border-border/60 bg-card py-2.5')} data-testid="chat-message-content" aria-busy={isStreaming}>
          {isUser ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{message.content}</p> : <FormattedReply content={message.content} />}
          {isStreaming && (message.content ? (
            <span aria-hidden="true" className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
          ) : (
            <span role="status" aria-label="返信を準備しています" className="inline-flex items-center gap-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground" />
              <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground animation-delay-100" />
              <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground animation-delay-200" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
