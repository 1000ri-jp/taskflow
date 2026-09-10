'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import type { CountdownTarget, SharedCountdownData } from '@/lib/dashboard/countdown';

async function requestCountdown(signal?: AbortSignal): Promise<SharedCountdownData> {
  const response = await fetch('/api/dashboard/countdown', { headers: await getAuthHeaders(), cache: 'no-store', signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '共有設定を取得できませんでした。');
  return result;
}

export function useSharedCountdown(userId: string) {
  const client = useQueryClient();
  const queryKey = ['shared-countdown', userId];
  const query = useQuery({
    queryKey, queryFn: ({ signal }) => requestCountdown(signal),
    staleTime: 15_000, refetchInterval: (query) => query.state.error ? false : 30_000, refetchOnWindowFocus: true, retry: false,
  });
  const mutation = useMutation({
    mutationFn: async ({ target, revision }: { target: CountdownTarget | null; revision: number }) => {
      const response = await fetch('/api/dashboard/countdown', {
        method: 'PATCH', headers: await getAuthHeaders(), body: JSON.stringify({ target, revision }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) await client.invalidateQueries({ queryKey });
        throw new Error(result.error || '共有設定を保存できませんでした。');
      }
      await client.invalidateQueries({ queryKey });
    },
  });
  return { data: query.data, isLoading: query.isPending, error: query.error, refresh: query.refetch, save: mutation.mutateAsync, isSaving: mutation.isPending };
}
