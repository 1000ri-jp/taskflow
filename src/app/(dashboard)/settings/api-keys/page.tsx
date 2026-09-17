'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useProjects } from '@/hooks/useProjects';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Key, Plus, Copy, Trash2, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import {
  formatApiTokenErrorMessage,
  readApiTokenError,
} from '@/lib/auth/apiTokenErrors';
import { getApiKeyProjectScopeLabels } from '@/lib/auth/apiKeyProjectScope';
import { normalizeAllowedProjectIdsForSave } from '@/lib/ai/projectAccess';
import type { ApiKey, ApiKeyPermission, ApiKeyCreateData } from '@/types/apiKey';
import { PERMISSION_GROUPS } from '@/types/apiKey';

const ACTOR_ICON_PRESETS = ['🤖', '🧠', '🛠️', '💬', '⚙️'];

export default function ApiKeysPage() {
  const { user, firebaseUser } = useAuth();
  const { projects, isLoading: projectsLoading } = useProjects();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newActorDisplayName, setNewActorDisplayName] = useState('');
  const [newActorIcon, setNewActorIcon] = useState('🤖');
  const [selectedPermissions, setSelectedPermissions] = useState<ApiKeyPermission[]>(['tasks:read']);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newPlainTextKey, setNewPlainTextKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [hasInitializedProjectScope, setHasInitializedProjectScope] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);
  const [listActionError, setListActionError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const projectNameMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );

  const getAuthHeaders = useCallback(async () => {
    if (!firebaseUser) {
      throw new Error('Not authenticated');
    }

    const token = await firebaseUser.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }, [firebaseUser]);

  const loadApiKeys = useCallback(async () => {
    if (!user?.id || !firebaseUser) {
      setLoadError('ログイン状態を確認できませんでした。ページを再読み込みして、もう一度お試しください。');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/auth/tokens', {
        headers: await getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(await readApiTokenError(response, 'APIキーの取得に失敗しました。'));
      }

      const data = await response.json() as { apiKeys: ApiKey[] };
      setApiKeys(
        data.apiKeys.map((key) => ({
          ...key,
          createdAt: new Date(key.createdAt),
          lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt) : null,
          expiresAt: key.expiresAt ? new Date(key.expiresAt) : null,
        }))
      );
      setListActionError(null);
    } catch (error) {
      setApiKeys([]);
      setLoadError(
        formatApiTokenErrorMessage(
          error instanceof Error ? error.message : null,
          'APIキーの取得に失敗しました。'
        )
      );
      console.error('Failed to load API keys:', error);
    } finally {
      setIsLoading(false);
    }
  }, [firebaseUser, getAuthHeaders, user?.id]);

  useEffect(() => {
    if (user?.id && firebaseUser) {
      loadApiKeys();
    }
  }, [firebaseUser, loadApiKeys, user?.id]);

  useEffect(() => {
    if (!isCreateDialogOpen || hasInitializedProjectScope || projectsLoading) {
      return;
    }

    setSelectedProjectIds(projects.map((project) => project.id));
    setHasInitializedProjectScope(true);
  }, [hasInitializedProjectScope, isCreateDialogOpen, projects, projectsLoading]);

  const handleCreateKey = async () => {
    if (!user?.id || !firebaseUser || !newKeyName.trim()) {
      setCreateError('ログイン状態を確認できませんでした。ページを再読み込みして、もう一度お試しください。');
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      const data: ApiKeyCreateData = {
        name: newKeyName.trim(),
        actorDisplayName: newActorDisplayName.trim() || null,
        actorIcon: newActorIcon.trim() || null,
        permissions: selectedPermissions,
        projectIds: normalizeAllowedProjectIdsForSave(
          selectedProjectIds,
          projects.map((project) => project.id)
        ),
        expiresAt: null, // Never expires for now
      };

      const response = await fetch('/api/auth/tokens', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          ...data,
          expiresAt: data.expiresAt ? data.expiresAt.toISOString() : null,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiTokenError(response, 'APIキーの作成に失敗しました。'));
      }

      const result = await response.json() as { plainTextKey: string };
      const { plainTextKey } = result;
      setNewPlainTextKey(plainTextKey);
      setListActionError(null);
      await loadApiKeys();
    } catch (error) {
      setCreateError(
        formatApiTokenErrorMessage(
          error instanceof Error ? error.message : null,
          'APIキーの作成に失敗しました。'
        )
      );
      console.error('Failed to create API key:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyKey = async () => {
    if (newPlainTextKey) {
      await navigator.clipboard.writeText(newPlainTextKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleCloseCreateDialog = () => {
    setIsCreateDialogOpen(false);
    setNewKeyName('');
    setNewActorDisplayName('');
    setNewActorIcon('🤖');
    setSelectedPermissions(['tasks:read']);
    setSelectedProjectIds([]);
    setHasInitializedProjectScope(false);
    setNewPlainTextKey(null);
    setCopiedKey(false);
    setCreateError(null);
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    if (!open) {
      handleCloseCreateDialog();
      return;
    }
    setIsCreateDialogOpen(true);
  };

  const handleDeactivateKey = async (key: ApiKey) => {
    if (!user?.id || !firebaseUser) {
      setListActionError('ログイン状態を確認できませんでした。ページを再読み込みして、もう一度お試しください。');
      return;
    }

    try {
      setListActionError(null);
      const response = await fetch(`/api/auth/tokens/${key.id}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(await readApiTokenError(response, 'APIキーの無効化に失敗しました。'));
      }

      await loadApiKeys();
    } catch (error) {
      setListActionError(
        formatApiTokenErrorMessage(
          error instanceof Error ? error.message : null,
          'APIキーの無効化に失敗しました。'
        )
      );
      console.error('Failed to deactivate API key:', error);
    }
  };

  const handleDeleteKey = async () => {
    if (!user?.id || !firebaseUser || !keyToDelete) {
      setDeleteError('ログイン状態を確認できませんでした。ページを再読み込みして、もう一度お試しください。');
      return;
    }

    try {
      setDeleteError(null);
      setListActionError(null);
      const response = await fetch(`/api/auth/tokens/${keyToDelete.id}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(await readApiTokenError(response, 'APIキーの削除に失敗しました。'));
      }

      await loadApiKeys();
      setKeyToDelete(null);
    } catch (error) {
      const message = formatApiTokenErrorMessage(
        error instanceof Error ? error.message : null,
        'APIキーの削除に失敗しました。'
      );
      setDeleteError(message);
      setListActionError(message);
      console.error('Failed to delete API key:', error);
    }
  };

  const togglePermission = (permission: ApiKeyPermission) => {
    setSelectedPermissions(prev => {
      // If selecting admin, clear others
      if (permission === 'admin') {
        return prev.includes('admin') ? [] : ['admin'];
      }
      // If admin is selected and selecting something else, remove admin
      if (prev.includes('admin')) {
        return [permission];
      }
      // Toggle the permission
      if (prev.includes(permission)) {
        return prev.filter(p => p !== permission);
      }
      return [...prev, permission];
    });
  };

  const formatDate = (date: Date | null) => {
    if (!date) return '-';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getPermissionLabel = (permission: ApiKeyPermission): string => {
    const labels: Record<ApiKeyPermission, string> = {
      'tasks:read': 'タスク閲覧',
      'tasks:write': 'タスク編集',
      'projects:read': 'プロジェクト閲覧',
      'projects:write': 'プロジェクト編集',
      'members:manage': 'メンバー管理',
      'admin': '全権限',
    };
    return labels[permission];
  };

  const toggleProjectScope = (projectId: string) => {
    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon" aria-label="設定に戻る" title="設定に戻る">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">APIキー管理</h1>
          <p className="text-muted-foreground">外部のAIやツールからTaskFlowにアクセスするためのAPIキーを管理します</p>
        </div>
      </div>

      <Card density="compact">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                APIキー
              </CardTitle>
              <CardDescription>
                MCPサーバーやその他の外部ツールで使用するAPIキーです
              </CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={handleCreateDialogOpenChange}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  新規作成
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-lg">
                {newPlainTextKey ? (
                  <div className="flex max-h-[85vh] flex-col">
                    <DialogHeader className="shrink-0 px-6 pt-6">
                      <DialogTitle className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                        APIキーが作成されました
                      </DialogTitle>
                      <DialogDescription>
                        このキーは一度だけ表示されます。必ずコピーして安全な場所に保存してください。
                      </DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4">
                      <div className="rounded-lg bg-muted p-4">
                        <div className="flex items-center gap-2">
                          <code className="flex-1 break-all text-sm font-mono">
                            {newPlainTextKey}
                          </code>
                          <Button variant="outline" size="icon" onClick={handleCopyKey}>
                            {copiedKey ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200">
                        <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                        <p className="text-sm">
                          このキーを他人と共有しないでください。キーが漏洩した場合は、すぐに無効化してください。
                        </p>
                      </div>
                    </div>
                    <DialogFooter className="shrink-0 border-t px-6 py-4">
                      <Button onClick={handleCloseCreateDialog}>閉じる</Button>
                    </DialogFooter>
                  </div>
                ) : (
                  <div className="flex max-h-[85vh] flex-col">
                    <DialogHeader className="shrink-0 px-6 pt-6">
                      <DialogTitle>新規APIキーを作成</DialogTitle>
                      <DialogDescription>
                        APIキーの名前と権限を設定してください
                      </DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="key-name">管理名</Label>
                        <Input
                          id="key-name"
                          placeholder="例: Claude Desktop用"
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          APIキー一覧で見分けるための内部名です。
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="actor-display-name">表示名</Label>
                        <Input
                          id="actor-display-name"
                          placeholder="例: Codex"
                          value={newActorDisplayName}
                          onChange={(e) => setNewActorDisplayName(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          コメントや監査表示では `ユーザー名 via 表示名` として表示されます。未設定時は管理名を使います。
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="actor-icon">アイコン</Label>
                        <div className="flex gap-2">
                          <Input
                            id="actor-icon"
                            className="w-20 text-center text-xl"
                            placeholder="🤖"
                            value={newActorIcon}
                            onChange={(e) => setNewActorIcon(e.target.value)}
                          />
                          <div className="flex flex-wrap gap-2">
                            {ACTOR_ICON_PRESETS.map((icon) => (
                              <Button
                                key={icon}
                                type="button"
                                variant={newActorIcon === icon ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setNewActorIcon(icon)}
                              >
                                {icon}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <Label>権限</Label>
                        {PERMISSION_GROUPS.map((group) => (
                          <div key={group.id} className="space-y-2">
                            <p className="text-sm font-medium text-muted-foreground">{group.label}</p>
                            {group.permissions.map((perm) => (
                              <div key={perm.id} className="flex items-start gap-3 pl-2">
                                <Checkbox
                                  id={perm.id}
                                  checked={selectedPermissions.includes(perm.id)}
                                  onCheckedChange={() => togglePermission(perm.id)}
                                  disabled={perm.id !== 'admin' && selectedPermissions.includes('admin')}
                                />
                                <div className="grid gap-0.5 leading-none">
                                  <label
                                    htmlFor={perm.id}
                                    className="text-sm font-medium cursor-pointer"
                                  >
                                    {perm.label}
                                  </label>
                                  <p className="text-xs text-muted-foreground">
                                    {perm.description}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between">
                          <Label>対象プロジェクト</Label>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedProjectIds(projects.map((project) => project.id))}
                              disabled={projectsLoading || projects.length === 0}
                            >
                              すべて選択
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedProjectIds([])}
                              disabled={projectsLoading || projects.length === 0}
                            >
                              すべて解除
                            </Button>
                          </div>
                        </div>

                        {projectsLoading ? (
                          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                            プロジェクトを読み込み中...
                          </div>
                        ) : projects.length === 0 ? (
                          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                            プロジェクトがありません。作成後にスコープを選択できます。
                          </div>
                        ) : (
                          <div className="space-y-2 rounded-md border p-3">
                            {projects.map((project) => (
                              <div key={project.id} className="flex items-start gap-3">
                                <Checkbox
                                  id={`token-project-${project.id}`}
                                  checked={selectedProjectIds.includes(project.id)}
                                  onCheckedChange={() => toggleProjectScope(project.id)}
                                />
                                <div className="grid gap-0.5 leading-none">
                                  <label
                                    htmlFor={`token-project-${project.id}`}
                                    className="cursor-pointer text-sm font-medium"
                                  >
                                    {project.name}
                                  </label>
                                  <p className="text-xs text-muted-foreground">
                                    {project.description || 'このプロジェクトへのAPIアクセスを許可'}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <p className="text-xs text-muted-foreground">
                          すべて選択した場合は全プロジェクト対象として保存されます。未選択のプロジェクトにはこのキーからアクセスできません。
                        </p>
                      </div>
                      {createError ? (
                        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3">
                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                          <span className="text-sm text-destructive">{createError}</span>
                        </div>
                      ) : null}
                    </div>
                    <DialogFooter className="shrink-0 border-t px-6 py-4">
                      <Button variant="outline" onClick={handleCloseCreateDialog}>
                        キャンセル
                      </Button>
                      <Button
                        onClick={handleCreateKey}
                        disabled={!newKeyName.trim() || selectedPermissions.length === 0 || isCreating || projectsLoading}
                      >
                        {isCreating ? '作成中...' : '作成'}
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">読み込み中...</div>
          ) : loadError ? (
            <div className="space-y-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                <div className="space-y-1">
                  <p className="font-medium text-destructive">APIキーを読み込めませんでした</p>
                  <p className="text-sm text-destructive">{loadError}</p>
                </div>
              </div>
              <Button variant="outline" onClick={() => void loadApiKeys()}>
                再読み込み
              </Button>
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Key className="mx-auto h-12 w-12 opacity-30" />
              <p className="mt-2">APIキーがありません</p>
              <p className="text-sm">新規作成ボタンからAPIキーを作成してください</p>
            </div>
          ) : (
            <div className="space-y-4">
              {listActionError ? (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                  <span className="text-sm text-destructive">{listActionError}</span>
                </div>
              ) : null}
              {apiKeys.map((key) => (
                <div
                  key={key.id}
                  className={`rounded-lg border p-4 ${!key.isActive ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{key.name}</span>
                        {!key.isActive && (
                          <Badge variant="secondary">無効</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{key.actorIcon || '🤖'}</span>
                        <span>{key.actorDisplayName || key.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm text-muted-foreground font-mono">
                          {key.keyPrefix}
                        </code>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {key.permissions.map((perm) => (
                          <Badge key={perm} variant="outline" className="text-xs">
                            {getPermissionLabel(perm)}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {getApiKeyProjectScopeLabels(key.projectIds, projectNameMap).map((label) => (
                          <Badge key={`${key.id}-${label}`} variant="secondary" className="text-xs">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {key.isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeactivateKey(key)}
                        >
                          無効化
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setKeyToDelete(key)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Separator className="my-3" />
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>作成: {formatDate(key.createdAt)}</span>
                    <span>最終使用: {formatDate(key.lastUsedAt)}</span>
                    {key.expiresAt && <span>有効期限: {formatDate(key.expiresAt)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card density="compact">
        <CardHeader>
          <CardTitle>MCP サーバー設定</CardTitle>
          <CardDescription>
            Claude DesktopやCursorなどのMCPクライアントで使用する設定です
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm text-muted-foreground mb-2">
              MCPクライアントの設定ファイルに以下を追加してください:
            </p>
            <pre className="text-xs bg-background p-3 rounded overflow-x-auto">
{`{
  "mcpServers": {
    "taskflow": {
      "command": "npx",
      "args": ["-y", "@taskflow/mcp-server"],
      "env": {
        "TASKFLOW_API_KEY": "your-api-key-here"
      }
    }
  }
}`}
            </pre>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!keyToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setKeyToDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>APIキーを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{keyToDelete?.name}」を削除します。この操作は取り消せません。
              このキーを使用しているすべてのアプリケーションは動作しなくなります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <span className="text-sm text-destructive">{deleteError}</span>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteKey}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
