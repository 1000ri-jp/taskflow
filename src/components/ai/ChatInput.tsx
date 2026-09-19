'use client';

import { useState, useEffect, useCallback, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, Paperclip } from 'lucide-react';

interface ChatInputProps {
  onImage?: (file: File, text: string) => void;
  onSend: (message: string) => void | Promise<void | boolean>;
  draftKey?: string;
  sentInput?: { id: string; content: string };
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
}
const inputDrafts = new Map<string, string>();

export function ChatInput({
  onSend,
  onImage,
  isLoading = false,
  disabled = false,
  placeholder = 'メッセージを入力...',
  draftKey,
  sentInput,
}: ChatInputProps) {
  const [message, setMessage] = useState(() => draftKey ? inputDrafts.get(draftKey) ?? '' : '');

  useEffect(() => {
    if (!sentInput) return;
    queueMicrotask(() => setMessage(current => {
      if (current.trim() !== sentInput.content.trim()) return current;
      if (draftKey) inputDrafts.delete(draftKey);
      return '';
    }));
  }, [sentInput, draftKey]);

  const handleSend = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || isLoading || disabled) return;

    try { const result = await onSend(trimmed); if (result !== false) { setMessage(''); if (draftKey) inputDrafts.delete(draftKey); } }
    catch { /* Keep the input; the owning conversation reports the error. */ }
  }, [message, isLoading, disabled, onSend, draftKey]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter without Shift (but not during IME composition)
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex items-end gap-2 border-t bg-background p-4">
      {onImage && <label className="self-center cursor-pointer rounded-md p-2 text-muted-foreground focus-within:ring-2" title="画像を添えて購入報告"><Paperclip aria-hidden="true" className="h-4 w-4"/><input className="sr-only" aria-label="画像を添えて購入報告" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled||isLoading} onChange={e=>{const file=e.target.files?.[0];if(file)onImage(file,message);e.target.value='';}}/></label>}
      <Textarea
        value={message}
        onChange={(e) => { setMessage(e.target.value); if (draftKey) inputDrafts.set(draftKey, e.target.value); }}
        onPaste={e=>{const file=Array.from(e.clipboardData.files).find(f=>f.type.startsWith('image/'));if(file&&onImage){e.preventDefault();onImage(file,message);}}}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading || disabled}
        className={`min-h-9 max-h-[200px] resize-none py-1.5 leading-5 ${message ? 'field-sizing-content' : 'field-sizing-fixed h-9'}`}
        rows={1}
      />
      <Button
        aria-label="送信"
        onClick={handleSend}
        disabled={!message.trim() || isLoading || disabled}
        size="icon"
        className="shrink-0"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
