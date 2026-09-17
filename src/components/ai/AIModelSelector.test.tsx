import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AIModelSelector } from './AIModelSelector';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { DEFAULT_MODELS } from '@/types/ai';

function Settings() {
  const store = useAISettingsStore();
  return <AIModelSelector provider={store.provider} model={store.getActiveModel()} defaultModel={DEFAULT_MODELS[store.provider]} onChange={(model) => store.setModel(store.provider, model)} />;
}

const choose = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'モデル' }), { target: { value } });
const saved = () => JSON.parse(localStorage.getItem('ai-settings-storage')!).state;

beforeEach(() => {
  localStorage.clear();
  useAISettingsStore.setState({ provider: 'gemini', geminiModel: DEFAULT_MODELS.gemini, openaiModel: 'my-openai-model', anthropicModel: DEFAULT_MODELS.anthropic });
});

describe('AI model selection', () => {
  it('persists a selection for the active provider and uses it without overwriting other providers', () => {
    const view = render(<Settings />);
    expect(localStorage.getItem('ai-settings-storage')).toBeNull();
    choose('gemini-3.1-pro-preview');
    expect(useAISettingsStore.getState().getActiveModel()).toBe('gemini-3.1-pro-preview');
    expect(saved()).toMatchObject({ provider: 'gemini', geminiModel: 'gemini-3.1-pro-preview', openaiModel: 'my-openai-model' });
    view.unmount();
    render(<Settings />);
    expect(screen.getByRole('combobox', { name: 'モデル' })).toHaveValue('gemini-3.1-pro-preview');
  });

  it('keeps draft and empty IDs out of the active settings until applied, then trims the ID', () => {
    render(<Settings />);
    choose('__custom_model__');
    const input = screen.getByRole('textbox', { name: 'モデルID' });
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: '適用' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useAISettingsStore.getState().getActiveModel()).toBe(DEFAULT_MODELS.gemini);
    fireEvent.change(input, { target: { value: 'invalid model' } });
    expect(screen.getByRole('button', { name: '適用' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '  gemini-custom-model  ' } });
    expect(localStorage.getItem('ai-settings-storage')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '適用' }));
    expect(saved().geminiModel).toBe('gemini-custom-model');
    expect(screen.getByRole('combobox', { name: 'モデル' })).toHaveValue('gemini-custom-model');
    expect(screen.queryByRole('textbox', { name: 'モデルID' })).not.toBeInTheDocument();
  });

  it('preserves an existing custom model and cancels without saving the draft', () => {
    useAISettingsStore.setState({ geminiModel: 'existing-custom-id' });
    render(<Settings />);
    expect(screen.getByRole('combobox', { name: 'モデル' })).toHaveValue('existing-custom-id');
    choose('__custom_model__');
    fireEvent.change(screen.getByRole('textbox', { name: 'モデルID' }), { target: { value: 'unfinished' } });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(useAISettingsStore.getState().getActiveModel()).toBe('existing-custom-id');
    expect(localStorage.getItem('ai-settings-storage')).toBeNull();
  });

  it('discards a draft on provider change and retains each provider choice', () => {
    render(<Settings />);
    choose('gemini-3.8-flash');
    choose('__custom_model__');
    fireEvent.change(screen.getByRole('textbox', { name: 'モデルID' }), { target: { value: 'unfinished' } });
    act(() => useAISettingsStore.getState().setProvider('openai'));
    expect(screen.queryByRole('textbox', { name: 'モデルID' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'モデル' })).toHaveValue('my-openai-model');
    choose('gpt-5.5');
    act(() => useAISettingsStore.getState().setProvider('gemini'));
    expect(screen.getByRole('combobox', { name: 'モデル' })).toHaveValue('gemini-3.8-flash');
    expect(saved().openaiModel).toBe('gpt-5.5');
  });

  it('resets only the active provider to its default', () => {
    useAISettingsStore.setState({ geminiModel: 'custom' });
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'デフォルトに戻す' }));
    expect(saved()).toMatchObject({ geminiModel: DEFAULT_MODELS.gemini, openaiModel: 'my-openai-model' });
    expect(screen.getByRole('button', { name: 'デフォルトに戻す' })).toBeDisabled();
  });
});
