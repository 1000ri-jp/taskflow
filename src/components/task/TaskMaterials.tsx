'use client';

import { FileText } from 'lucide-react';
import type { CommentAttachment } from '@/types';
import { safeMaterialUrl } from '@/lib/task/continuation';

export function TaskMaterials({ files, label = '資料' }: { files: readonly CommentAttachment[]; label?: string }) {
  return <div className="space-y-2" aria-label={label}>
    {files.map(file => safeMaterialUrl(file.url)
      ? <a key={`${file.id}:${file.url}`} href={file.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm text-primary hover:underline"><FileText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{file.name}</span><span className="ml-auto shrink-0 text-xs">開く</span></a>
      : <p key={file.id} role="alert" className="text-xs text-amber-800">{file.name}のリンクを確認できません。</p>)}
  </div>;
}
