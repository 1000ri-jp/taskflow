'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { AIProviderType, PROVIDER_DISPLAY_NAMES, DEFAULT_MODELS } from '@/types/ai';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import { useAuthStore } from '@/stores/authStore';

interface UseAISettingsReturn {
  provider: AIProviderType;
  isConfigured: boolean;
  isSaving: boolean;
  isProjectAccessSaving: boolean;
  projectAccessError: string | null;
  projectAccessLoaded: boolean;
  model: string;
  allowedProjectIds: string[] | null;
  providers: Array<{ value: AIProviderType; label: string }>;
  defaultModels: Record<AIProviderType, string>;
  setProvider: (provider: AIProviderType) => void;
  saveApiKey: (apiKey: string) => Promise<void>;
  saveProjectAccess: (allowedProjectIds: string[] | null) => Promise<void>;
  setModel: (model: string) => void;
  refreshKeyStatus: () => Promise<void>;
  refreshProjectAccess: () => Promise<void>;
}

export function useAISettings(): UseAISettingsReturn {
  const store = useAISettingsStore();
  const { provider, setKeyConfigured, setAllowedProjectIds, setProjectAccessLoaded } = store;
  const { isAuthenticated } = useAuthStore();
  const [isSaving, setIsSaving] = useState(false);
  const [isProjectAccessSaving, setIsProjectAccessSaving] = useState(false);
  const [projectAccessError, setProjectAccessError] = useState<string | null>(null);

  const providers = Object.entries(PROVIDER_DISPLAY_NAMES).map(([value, label]) => ({
    value: value as AIProviderType,
    label,
  }));

  // Refresh key status from server on mount
  const refreshKeyStatus = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/ai/keys', { headers });

      if (response.ok) {
        const data = await response.json();
        if (data.openai !== undefined) setKeyConfigured('openai', data.openai);
        if (data.anthropic !== undefined) setKeyConfigured('anthropic', data.anthropic);
        if (data.gemini !== undefined) setKeyConfigured('gemini', data.gemini);
      }
    } catch {
      // Silently fail - key status will be stale but functional
    }
  }, [isAuthenticated, setKeyConfigured]);

  const refreshProjectAccess = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setProjectAccessError(null);
      const headers = await getAuthHeaders();
      const response = await fetch('/api/ai/settings', { headers });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'AIアクセス設定の取得に失敗しました');
      }

      const data = await response.json();
      setAllowedProjectIds(
        Array.isArray(data.allowedProjectIds) ? data.allowedProjectIds : null
      );
      setProjectAccessLoaded(true);
    } catch (error) {
      setProjectAccessLoaded(false);
      setProjectAccessError(
        error instanceof Error ? error.message : 'AIアクセス設定の取得に失敗しました'
      );
    }
  }, [isAuthenticated, setAllowedProjectIds, setProjectAccessLoaded]);

  // Depend on stable actions: each response updates the store, so depending on
  // the whole store here would start another request after every response.
  useEffect(() => {
    refreshKeyStatus();
    refreshProjectAccess();
  }, [refreshKeyStatus, refreshProjectAccess]);

  // Save API key to server
  const saveApiKey = useCallback(async (apiKey: string) => {
    setIsSaving(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/ai/keys', {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider, apiKey }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'APIキーの保存に失敗しました');
      }

      setKeyConfigured(provider, apiKey.length > 0);
    } finally {
      setIsSaving(false);
    }
  }, [provider, setKeyConfigured]);

  const saveProjectAccess = useCallback(async (allowedProjectIds: string[] | null) => {
    setIsProjectAccessSaving(true);
    setProjectAccessError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/ai/settings', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ allowedProjectIds }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'AIアクセス設定の保存に失敗しました');
      }

      const data = await response.json();
      setAllowedProjectIds(
        Array.isArray(data.allowedProjectIds) ? data.allowedProjectIds : null
      );
      setProjectAccessLoaded(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'AIアクセス設定の保存に失敗しました';
      setProjectAccessError(message);
      throw error;
    } finally {
      setIsProjectAccessSaving(false);
    }
  }, [setAllowedProjectIds, setProjectAccessLoaded]);

  return {
    provider: store.provider,
    isConfigured: store.isConfigured(),
    isSaving,
    isProjectAccessSaving,
    projectAccessError,
    projectAccessLoaded: store.projectAccessLoaded,
    model: store.getActiveModel(),
    allowedProjectIds: store.allowedProjectIds,
    providers,
    defaultModels: DEFAULT_MODELS,
    setProvider: store.setProvider,
    saveApiKey,
    saveProjectAccess,
    setModel: (model: string) => store.setModel(store.provider, model),
    refreshKeyStatus,
    refreshProjectAccess,
  };
}
