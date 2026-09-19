'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '@/stores/authStore';
import { subscribeToUserMemo, updateUserMemo } from '@/lib/firebase/firestore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { StickyNote, Loader2 } from 'lucide-react';
import debounce from 'lodash/debounce';

const mockMemos = new Map<string, string>();

export function PersonalMemo() {
  const { user } = useAuthStore();
  const [memo, setMemo] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Debounced save function
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(
    debounce(async (userId: string, content: string) => {
      setIsSaving(true);
      try {
        await updateUserMemo(userId, content);
      } catch (error) {
        console.error('Failed to save memo:', error);
      } finally {
        setIsSaving(false);
      }
    }, 1000),
    []
  );

  // Subscribe to memo updates
  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    if (isE2EMockAuthEnabled()) {
      Promise.resolve().then(() => {
        setMemo(mockMemos.get(user.id) ?? '');
        setIsLoading(false);
      });
      return;
    }

    const unsubscribe = subscribeToUserMemo(user.id, (content) => {
      setMemo(content);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user?.id]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setMemo(newValue);

    if (user?.id) {
      if (isE2EMockAuthEnabled()) {
        mockMemos.set(user.id, newValue);
      } else {
        debouncedSave(user.id, newValue);
      }
    }
  };

  if (!user) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <StickyNote className="h-4 w-4" />
          個人メモ
          {isSaving && (
            <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Textarea
            value={memo}
            onChange={handleChange}
            placeholder="メモを入力..."
            className="min-h-[150px] resize-none"
          />
        )}
      </CardContent>
    </Card>
  );
}
