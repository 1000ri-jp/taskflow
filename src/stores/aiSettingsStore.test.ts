import { describe, it, expect, beforeEach } from 'vitest';
import { useAISettingsStore } from './aiSettingsStore';

describe('aiSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAISettingsStore.setState({
      provider: 'openai',
      openaiKeyConfigured: false,
      anthropicKeyConfigured: false,
      geminiKeyConfigured: false,
      allowedProjectIds: null,
      projectAccessLoaded: false,
      openaiModel: 'gpt-4o',
      anthropicModel: 'claude-sonnet-4-20250514',
      geminiModel: 'gemini-3-flash-preview',
    });
  });

  describe('setProvider', () => {
    it('should change the active provider', () => {
      useAISettingsStore.getState().setProvider('anthropic');
      expect(useAISettingsStore.getState().provider).toBe('anthropic');
    });
  });

  describe('setKeyConfigured', () => {
    it('should set openai key as configured', () => {
      useAISettingsStore.getState().setKeyConfigured('openai', true);
      expect(useAISettingsStore.getState().openaiKeyConfigured).toBe(true);
    });

    it('should set anthropic key as configured', () => {
      useAISettingsStore.getState().setKeyConfigured('anthropic', true);
      expect(useAISettingsStore.getState().anthropicKeyConfigured).toBe(true);
    });

    it('should set gemini key as configured', () => {
      useAISettingsStore.getState().setKeyConfigured('gemini', true);
      expect(useAISettingsStore.getState().geminiKeyConfigured).toBe(true);
    });

    it('should unset key configuration', () => {
      useAISettingsStore.getState().setKeyConfigured('openai', true);
      useAISettingsStore.getState().setKeyConfigured('openai', false);
      expect(useAISettingsStore.getState().openaiKeyConfigured).toBe(false);
    });
  });

  describe('setModel', () => {
    it('should change openai model', () => {
      useAISettingsStore.getState().setModel('openai', 'gpt-4-turbo');
      expect(useAISettingsStore.getState().openaiModel).toBe('gpt-4-turbo');
    });

    it('should change anthropic model', () => {
      useAISettingsStore.getState().setModel('anthropic', 'claude-3-opus');
      expect(useAISettingsStore.getState().anthropicModel).toBe('claude-3-opus');
    });

    it('should change gemini model', () => {
      useAISettingsStore.getState().setModel('gemini', 'gemini-pro');
      expect(useAISettingsStore.getState().geminiModel).toBe('gemini-pro');
    });
  });

  describe('project access', () => {
    it('should store restricted project ids', () => {
      useAISettingsStore.getState().setAllowedProjectIds(['project-1']);
      useAISettingsStore.getState().setProjectAccessLoaded(true);

      expect(useAISettingsStore.getState().allowedProjectIds).toEqual(['project-1']);
      expect(useAISettingsStore.getState().projectAccessLoaded).toBe(true);
    });

    it('should allow every project when access is unrestricted', () => {
      expect(useAISettingsStore.getState().canAccessProject('project-1')).toBe(true);
    });

    it('should block projects outside the restricted set', () => {
      useAISettingsStore.getState().setAllowedProjectIds(['project-2']);
      expect(useAISettingsStore.getState().canAccessProject('project-1')).toBe(false);
      expect(useAISettingsStore.getState().canAccessProject('project-2')).toBe(true);
    });
  });

  describe('getActiveModel', () => {
    it('should return model for the active provider', () => {
      expect(useAISettingsStore.getState().getActiveModel()).toBe('gpt-4o');

      useAISettingsStore.getState().setProvider('anthropic');
      expect(useAISettingsStore.getState().getActiveModel()).toBe('claude-sonnet-4-20250514');

      useAISettingsStore.getState().setProvider('gemini');
      expect(useAISettingsStore.getState().getActiveModel()).toBe('gemini-3-flash-preview');
    });

    it('should return updated model after setModel', () => {
      useAISettingsStore.getState().setModel('openai', 'gpt-4-turbo');
      expect(useAISettingsStore.getState().getActiveModel()).toBe('gpt-4-turbo');
    });
  });

  describe('isConfigured', () => {
    it('should return false when no key is configured', () => {
      expect(useAISettingsStore.getState().isConfigured()).toBe(false);
    });

    it('should return true when active provider key is configured', () => {
      useAISettingsStore.getState().setKeyConfigured('openai', true);
      expect(useAISettingsStore.getState().isConfigured()).toBe(true);
    });

    it('should return false when different provider key is configured', () => {
      useAISettingsStore.getState().setKeyConfigured('anthropic', true);
      // Active provider is still openai
      expect(useAISettingsStore.getState().isConfigured()).toBe(false);
    });

    it('should reflect provider switch', () => {
      useAISettingsStore.getState().setKeyConfigured('anthropic', true);
      useAISettingsStore.getState().setProvider('anthropic');
      expect(useAISettingsStore.getState().isConfigured()).toBe(true);
    });
  });
});
