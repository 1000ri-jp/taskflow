import { create } from 'zustand';
import { AIProviderType, DEFAULT_MODELS } from '@/types/ai';

interface AISettingsState {
  // Current provider
  provider: AIProviderType;
  // Key status (whether keys are configured server-side)
  openaiKeyConfigured: boolean;
  anthropicKeyConfigured: boolean;
  geminiKeyConfigured: boolean;
  // Project access scope. Null means all projects are allowed.
  allowedProjectIds: string[] | null;
  projectAccessLoaded: boolean;
  // Models
  openaiModel: string;
  anthropicModel: string;
  geminiModel: string;
  // Actions
  setProvider: (provider: AIProviderType) => void;
  setKeyConfigured: (provider: AIProviderType, configured: boolean) => void;
  setAllowedProjectIds: (projectIds: string[] | null) => void;
  setProjectAccessLoaded: (loaded: boolean) => void;
  setModel: (provider: AIProviderType, model: string) => void;
  getActiveModel: () => string;
  isConfigured: () => boolean;
  canAccessProject: (projectId: string | null | undefined) => boolean;
}

const STORAGE_KEY = 'ai-settings-storage';
type PersistedSettings = Pick<AISettingsState, 'provider' | 'openaiKeyConfigured' | 'anthropicKeyConfigured' | 'geminiKeyConfigured' | 'openaiModel' | 'anthropicModel' | 'geminiModel'>;
const defaultSettings: PersistedSettings = {
  provider: 'openai', openaiKeyConfigured: false, anthropicKeyConfigured: false, geminiKeyConfigured: false,
  openaiModel: DEFAULT_MODELS.openai, anthropicModel: DEFAULT_MODELS.anthropic, geminiModel: DEFAULT_MODELS.gemini,
};
const modelFields = { openai: 'openaiModel', anthropic: 'anthropicModel', gemini: 'geminiModel' } as const;
const keyFields = { openai: 'openaiKeyConfigured', anthropic: 'anthropicKeyConfigured', gemini: 'geminiKeyConfigured' } as const;
const validProvider = (value: unknown): value is AIProviderType => value === 'openai' || value === 'anthropic' || value === 'gemini';

function storedFields(value: unknown): Partial<PersistedSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: Partial<PersistedSettings> = {};
  if (validProvider(record.provider)) result.provider = record.provider;
  for (const field of Object.values(keyFields)) if (typeof record[field] === 'boolean') result[field] = record[field];
  for (const field of Object.values(modelFields)) if (typeof record[field] === 'string') result[field] = record[field];
  return result;
}

function readSavedSettings(): Partial<PersistedSettings> | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && 'state' in parsed ? storedFields(parsed.state) : {};
  } catch { return undefined; }
}

// Each action patches only its own field into the latest shared snapshot, never a stale tab's full state.
function saveSettingsPatch(current: AISettingsState, patch: Partial<PersistedSettings>): Partial<PersistedSettings> {
  const latest = { ...storedFields(current), ...readSavedSettings(), ...patch };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: latest, version: 0 })); }
  catch { /* Keep the selected value usable in this tab when browser storage is unavailable. */ }
  return latest;
}

export const useAISettingsStore = create<AISettingsState>((set, get) => ({
  ...defaultSettings,
  allowedProjectIds: null,
  projectAccessLoaded: false,

  setProvider: (provider) => {
    if (validProvider(provider)) set(saveSettingsPatch(get(), { provider }));
  },
  setKeyConfigured: (provider, configured) => {
    if (validProvider(provider)) set(saveSettingsPatch(get(), { [keyFields[provider]]: configured }));
  },
  // These server-derived access fields are deliberately memory-only.
  setAllowedProjectIds: (allowedProjectIds) => set({ allowedProjectIds }),
  setProjectAccessLoaded: (projectAccessLoaded) => set({ projectAccessLoaded }),
  setModel: (provider, model) => {
    if (validProvider(provider)) set(saveSettingsPatch(get(), { [modelFields[provider]]: model }));
  },
  getActiveModel: () => get()[modelFields[get().provider]],
  isConfigured: () => get()[keyFields[get().provider]],
  canAccessProject: (projectId) => !projectId || get().allowedProjectIds === null || get().allowedProjectIds!.includes(projectId),
}));

if (typeof window !== 'undefined') {
  // Hydrate after creating the store so the server/first client snapshot keeps the same defaults.
  const saved = readSavedSettings();
  if (saved) useAISettingsStore.setState(saved);
  const sync = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    try { if (event.storageArea && event.storageArea !== window.localStorage) return; }
    catch { return; }
    // Read current storage, not event.newValue: an older queued event must not revive an old choice.
    const latest = readSavedSettings();
    if (latest) useAISettingsStore.setState({ ...defaultSettings, ...latest });
  };
  // Fast Refresh can re-evaluate this module. Replace its listener instead of accumulating old stores.
  const owner = window as Window & { __taskflowAISettingsSync?: (event: StorageEvent) => void };
  if (owner.__taskflowAISettingsSync) window.removeEventListener('storage', owner.__taskflowAISettingsSync);
  owner.__taskflowAISettingsSync = sync;
  window.addEventListener('storage', sync);
}
