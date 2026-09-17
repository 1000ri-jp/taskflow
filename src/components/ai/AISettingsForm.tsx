'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAISettings } from '@/hooks/useAISettings';
import { AIModelSelector } from './AIModelSelector';
import { useProjects } from '@/hooks/useProjects';
import { filterProjectsForAI, normalizeAllowedProjectIdsForSave } from '@/lib/ai/projectAccess';
import { AIProviderType } from '@/types/ai';
import { Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export function AISettingsForm() {
  const {
    provider,
    isConfigured,
    isSaving,
    isProjectAccessSaving,
    projectAccessError,
    projectAccessLoaded,
    model,
    allowedProjectIds,
    providers,
    defaultModels,
    setProvider,
    saveApiKey,
    saveProjectAccess,
    setModel,
  } = useAISettings();
  const { projects, isLoading: projectsLoading } = useProjects();

  const [showApiKey, setShowApiKey] = useState(false);
  const [localApiKey, setLocalApiKey] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [projectAccessSaveSuccess, setProjectAccessSaveSuccess] = useState(false);
  const [projectAccessSaveError, setProjectAccessSaveError] = useState<string | null>(null);

  const visibleAllowedProjectIds = useMemo(
    () => filterProjectsForAI(projects, allowedProjectIds).map((project) => project.id),
    [projects, allowedProjectIds]
  );

  useEffect(() => {
    setSelectedProjectIds(visibleAllowedProjectIds);
  }, [visibleAllowedProjectIds]);

  const handleProviderChange = (value: string) => {
    setProvider(value as AIProviderType);
    setLocalApiKey('');
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleSaveApiKey = async () => {
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await saveApiKey(localApiKey);
      setLocalApiKey('');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'APIキーの保存に失敗しました');
    }
  };

  const handleToggleProject = (projectId: string) => {
    setProjectAccessSaveSuccess(false);
    setProjectAccessSaveError(null);
    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  };

  const handleSelectAllProjects = () => {
    setProjectAccessSaveSuccess(false);
    setProjectAccessSaveError(null);
    setSelectedProjectIds(projects.map((project) => project.id));
  };

  const handleClearAllProjects = () => {
    setProjectAccessSaveSuccess(false);
    setProjectAccessSaveError(null);
    setSelectedProjectIds([]);
  };

  const hasProjectAccessChanges = useMemo(() => {
    if (selectedProjectIds.length !== visibleAllowedProjectIds.length) {
      return true;
    }

    const selectedProjectIdSet = new Set(selectedProjectIds);
    return visibleAllowedProjectIds.some((projectId) => !selectedProjectIdSet.has(projectId));
  }, [selectedProjectIds, visibleAllowedProjectIds]);

  const handleSaveProjectAccess = async () => {
    setProjectAccessSaveError(null);
    setProjectAccessSaveSuccess(false);

    try {
      const normalizedAllowedProjectIds = normalizeAllowedProjectIdsForSave(
        selectedProjectIds,
        projects.map((project) => project.id)
      );
      await saveProjectAccess(normalizedAllowedProjectIds);
      setProjectAccessSaveSuccess(true);
      setTimeout(() => setProjectAccessSaveSuccess(false), 3000);
    } catch (error) {
      setProjectAccessSaveError(
        error instanceof Error ? error.message : 'AIアクセス設定の保存に失敗しました'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <Card density="compact">
        <CardHeader>
          <CardTitle>AIプロバイダー</CardTitle>
          <CardDescription>
            使用するAIプロバイダーを選択してください
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>プロバイダー</Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger>
                <SelectValue placeholder="プロバイダーを選択" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>APIキー</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={localApiKey}
                  onChange={(e) => setLocalApiKey(e.target.value)}
                  placeholder={
                    isConfigured
                      ? '新しいAPIキーを入力して更新'
                      : `${provider.toUpperCase()} APIキーを入力`
                  }
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  aria-label={showApiKey ? '入力中のAPIキーを隠す' : '入力中のAPIキーを表示'}
                  title={showApiKey ? '入力中のAPIキーを隠す' : '入力中のAPIキーを表示'}
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <Button
                onClick={handleSaveApiKey}
                disabled={!localApiKey || isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                保存
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              APIキーはサーバー側に安全に保存されます。ブラウザには保存されません。
            </p>
          </div>

          {/* Save feedback */}
          {saveError && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">{saveError}</span>
            </div>
          )}
          {saveSuccess && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 p-3">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-600">APIキーを保存しました</span>
            </div>
          )}

          {/* API Key Status */}
          <div className="flex items-center gap-2 rounded-md bg-muted p-3">
            {isConfigured ? (
              <>
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm text-green-600">
                  APIキーが設定されています
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm text-yellow-600">
                  APIキーが未設定です
                </span>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Model Configuration */}
      <Card density="compact">
        <CardHeader>
          <CardTitle>モデル設定</CardTitle>
          <CardDescription>
            使用するAIモデルを設定します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AIModelSelector
            provider={provider}
            model={model}
            defaultModel={defaultModels[provider]}
            onChange={setModel}
          />
        </CardContent>
      </Card>

      <Card density="compact">
        <CardHeader>
          <CardTitle>AIアクセス対象プロジェクト</CardTitle>
          <CardDescription>
            AIが閲覧・操作できるプロジェクトを選択します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSelectAllProjects}
              disabled={projectsLoading || projects.length === 0}
            >
              すべて選択
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearAllProjects}
              disabled={projectsLoading || projects.length === 0}
            >
              すべて解除
            </Button>
          </div>

          {!projectAccessLoaded && !projectAccessError ? (
            <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              AIアクセス設定を読み込み中...
            </div>
          ) : projectsLoading ? (
            <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              プロジェクトを読み込み中...
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              プロジェクトがありません。作成後にAIアクセス対象を選択できます。
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {projects.map((project) => (
                <div key={project.id} className="flex items-start gap-3 p-3">
                  <Checkbox
                    id={`ai-project-${project.id}`}
                    checked={selectedProjectIds.includes(project.id)}
                    onCheckedChange={() => handleToggleProject(project.id)}
                  />
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 leading-snug">
                    <label
                      htmlFor={`ai-project-${project.id}`}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {project.name}
                    </label>
                    <p className="min-w-0 break-words text-xs text-muted-foreground">
                      {project.description || 'このプロジェクトでAIを利用できます'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(projectAccessError || projectAccessSaveError) && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">
                {projectAccessSaveError || projectAccessError}
              </span>
            </div>
          )}

          {projectAccessSaveSuccess && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 p-3">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-600">AIアクセス設定を保存しました</span>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">
              未選択のプロジェクトは相棒AIの対象外になります。
            </p>
            <Button
              type="button"
              onClick={handleSaveProjectAccess}
              disabled={projectsLoading || isProjectAccessSaving || !hasProjectAccessChanges}
            >
              {isProjectAccessSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* API Key Help */}
      <Card density="compact">
        <CardHeader>
          <CardTitle>APIキーの取得方法</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <strong>OpenAI:</strong>{' '}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              platform.openai.com/api-keys
            </a>
            でAPIキーを作成
          </div>
          <div>
            <strong>Anthropic:</strong>{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              console.anthropic.com/settings/keys
            </a>
            でAPIキーを作成
          </div>
          <div>
            <strong>Google (Gemini):</strong>{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              aistudio.google.com/app/apikey
            </a>
            でAPIキーを作成
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
