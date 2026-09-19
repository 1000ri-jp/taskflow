'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ToolCall } from '@/lib/ai/tools/types';
import { getToolCallsDescription } from '@/lib/ai/toolExecutor';
import { CheckCircle2, ListTodo, Loader2, Edit, Trash2, Move } from 'lucide-react';

interface ToolConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolCalls: ToolCall[];
  onConfirm: () => void;
  onCancel: () => void;
  isExecuting?: boolean;
  descriptionChange?: { before: string; after: string };
}

// Get appropriate title and description based on tool types
function getDialogContent(toolCalls: ToolCall[]) {
  const hasCreate = toolCalls.some((t) => t.name.startsWith('create'));
  const hasDelete = toolCalls.some((t) => t.name.startsWith('delete'));
  const hasUpdate = toolCalls.some((t) => t.name.startsWith('update') || t.name.startsWith('complete') || t.name.startsWith('assign'));
  const hasMove = toolCalls.some((t) => t.name.startsWith('move'));

  if (hasDelete) {
    return {
      icon: Trash2,
      title: '削除しますか？',
      description: 'AIが以下の操作を実行しようとしています。',
      confirmText: '削除する',
      executingText: '削除中...',
    };
  }
  if (hasCreate && !hasUpdate && !hasMove) {
    return {
      icon: ListTodo,
      title: 'タスクを作成しますか？',
      description: `AIが以下の${toolCalls.length > 1 ? `${toolCalls.length}件の` : ''}タスクを作成しようとしています。`,
      confirmText: '作成する',
      executingText: '作成中...',
    };
  }
  if (hasMove) {
    return {
      icon: Move,
      title: 'タスクを移動しますか？',
      description: 'AIが以下の操作を実行しようとしています。',
      confirmText: '移動する',
      executingText: '移動中...',
    };
  }
  // Default for update/edit operations
  return {
    icon: Edit,
    title: '操作を実行しますか？',
    description: 'AIが以下の操作を実行しようとしています。',
    confirmText: '実行する',
    executingText: '実行中...',
  };
}

export function ToolConfirmDialog({
  open,
  onOpenChange,
  toolCalls,
  onConfirm,
  onCancel,
  isExecuting = false,
  descriptionChange,
}: ToolConfirmDialogProps) {
  const descriptions = getToolCallsDescription(toolCalls);
  const { icon: Icon, title, description, confirmText, executingText } = getDialogContent(toolCalls);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!isExecuting}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {descriptionChange ? '説明を保存しますか？' : title}
          </DialogTitle>
          <DialogDescription>
            {descriptionChange ? toolCalls[0]?.arguments.taskTitle as string : description}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto">
          {descriptionChange && <div className="mb-3 space-y-3 text-sm"><div><p className="font-medium">変更前</p><p className="whitespace-pre-wrap break-words">{descriptionChange.before || '（説明なし）'}</p></div><div><p className="font-medium">変更後</p><p className="whitespace-pre-wrap break-words">{descriptionChange.after || '（説明なし）'}</p></div></div>}
          {!descriptionChange && <ul className="space-y-2">
            {descriptions.map((desc, index) => (
              <li
                key={index}
                data-testid="tool-confirm-item"
                className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{desc}</span>
              </li>
            ))}
          </ul>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isExecuting}
            data-testid="tool-confirm-cancel"
          >
            キャンセル
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isExecuting}
            data-testid="tool-confirm-execute"
          >
            {isExecuting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {executingText}
              </>
            ) : (
              <>{descriptionChange ? '保存する' : confirmText}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
