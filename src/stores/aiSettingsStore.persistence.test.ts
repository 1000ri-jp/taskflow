import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAISettingsStore } from './aiSettingsStore';
import { DEFAULT_MODELS } from '@/types/ai';

const key = 'ai-settings-storage';
const initial = {
  provider: 'gemini' as const,
  openaiModel: 'openai-old', anthropicModel: 'anthropic-old', geminiModel: 'gemini-old',
  openaiKeyConfigured: true, anthropicKeyConfigured: false, geminiKeyConfigured: true,
};
const saved = () => JSON.parse(localStorage.getItem(key)!).state;
const externalSave = (patch: Record<string, unknown>) => {
  localStorage.setItem(key, JSON.stringify({ state: { ...saved(), ...patch }, version: 0 }));
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(key, JSON.stringify({ state: initial, version: 0 }));
  useAISettingsStore.setState({ ...initial, allowedProjectIds: ['project-a'], projectAccessLoaded: true });
});
afterEach(() => vi.restoreAllMocks());

describe('AI choices across tabs', () => {
  it('does not overwrite an explicit OpenAI selection when a stale tab refreshes key or access status', () => {
    externalSave({ provider: 'openai', openaiModel: 'openai-new' });
    const actions = useAISettingsStore.getState();
    expect(actions.provider).toBe('gemini'); // This tab has not received its storage event yet.
    const write = vi.spyOn(Storage.prototype, 'setItem');
    actions.setProjectAccessLoaded(false);
    actions.setAllowedProjectIds(['project-b']);
    expect(write).not.toHaveBeenCalled();
    actions.setKeyConfigured('gemini', false);
    expect(saved()).toMatchObject({ provider: 'openai', openaiModel: 'openai-new', geminiKeyConfigured: false });
    expect(useAISettingsStore.getState().provider).toBe('openai');
    expect(saved()).not.toHaveProperty('allowedProjectIds');
    expect(saved()).not.toHaveProperty('projectAccessLoaded');
  });

  it('keeps other providers models and key caches when changing one model from a stale tab', () => {
    externalSave({ provider: 'openai', openaiModel: 'openai-from-other-tab', anthropicKeyConfigured: true });
    useAISettingsStore.getState().setModel('gemini', 'gemini-new');
    expect(saved()).toMatchObject({ provider: 'openai', openaiModel: 'openai-from-other-tab', geminiModel: 'gemini-new', anthropicKeyConfigured: true });
    externalSave({ anthropicModel: 'anthropic-from-other-tab' });
    useAISettingsStore.getState().setProvider('anthropic');
    expect(saved()).toMatchObject({ provider: 'anthropic', openaiModel: 'openai-from-other-tab', geminiModel: 'gemini-new', anthropicModel: 'anthropic-from-other-tab' });
  });

  it('patches a key status without losing another tab’s provider, model, or other key status', () => {
    externalSave({ provider: 'openai', openaiModel: 'new-model', anthropicKeyConfigured: true });
    useAISettingsStore.getState().setKeyConfigured('openai', false);
    expect(saved()).toMatchObject({ provider: 'openai', openaiModel: 'new-model', anthropicKeyConfigured: true, openaiKeyConfigured: false });
    useAISettingsStore.getState().setKeyConfigured('openai', true);
    expect(saved().openaiKeyConfigured).toBe(true);
  });

  it('syncs the latest stored choice without writing it back or consuming a delayed event value', () => {
    externalSave({ provider: 'openai', openaiModel: 'new-model' });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage, newValue: JSON.stringify({ state: initial, version: 0 }) }));
    expect(useAISettingsStore.getState()).toMatchObject({ provider: 'openai', openaiModel: 'new-model', allowedProjectIds: ['project-a'], projectAccessLoaded: true });
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps the legacy version-0 shape and ignores unknown persisted fields', () => {
    localStorage.setItem(key, JSON.stringify({ state: { provider: 'anthropic', anthropicKeyConfigured: true, anthropicModel: 'custom', allowedProjectIds: ['not-authorized'], secret: 'not-copied' }, version: 0 }));
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
    expect(useAISettingsStore.getState()).toMatchObject({ provider: 'anthropic', anthropicKeyConfigured: true, anthropicModel: 'custom', allowedProjectIds: ['project-a'] });
    useAISettingsStore.getState().setProvider('openai');
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ version: 0, state: { provider: 'openai', anthropicKeyConfigured: true, anthropicModel: 'custom' } });
    expect(saved()).not.toHaveProperty('secret');
    expect(saved()).not.toHaveProperty('allowedProjectIds');
  });

  it('resets shared choices after a storage clear without writing defaults or resetting server access state', () => {
    localStorage.clear();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    expect(useAISettingsStore.getState()).toMatchObject({ provider: 'openai', openaiModel: DEFAULT_MODELS.openai, allowedProjectIds: ['project-a'], projectAccessLoaded: true });
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps the current tab usable when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    useAISettingsStore.getState().setProvider('openai');
    useAISettingsStore.getState().setModel('openai', 'chosen-model');
    useAISettingsStore.getState().setKeyConfigured('openai', true);
    expect(useAISettingsStore.getState().provider).toBe('openai');
    expect(useAISettingsStore.getState().getActiveModel()).toBe('chosen-model');
    expect(useAISettingsStore.getState().isConfigured()).toBe(true);
  });
});
