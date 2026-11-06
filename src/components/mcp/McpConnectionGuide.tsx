'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { settingActionRow, settingControlStack } from '@/components/ui/setting-field';
import { HelpText, Prose } from '@/components/ui/typography';

const MCP_URL = 'https://slowth.1000ri.jp/api/mcp';
const CONNECTION_FIELDS = [
  { id: 'mcp-server-url', label: 'サーバーURL', value: MCP_URL,
    description: 'リモート接続用です。ローカルファイルのパスやAPIキーは不要です。' },
  { id: 'mcp-muse-client-id', label: 'MuseのClient ID', value: 'slowth-muse',
    description: 'Muse専用のIDです。slowth-mcpを入力するとinvalid_requestになります。' },
  { id: 'mcp-muse-client-secret', label: 'MuseのClient Secret', value: '',
    placeholder: '空欄のままにしてください',
    description: '何も入力しません。APIキーやClient IDが入っている場合は削除してください。' },
  { id: 'mcp-claude-code-command', label: 'Claude Codeの登録コマンド',
    value: `claude mcp add --transport http slowth ${MCP_URL}`,
    description: '登録後、Claude Codeの /mcp から認証してください。' },
];

export function McpConnectionGuide() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  async function copy(id: string, value: string) {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
    } catch {
      setCopiedId(null);
      setCopyError('コピーできませんでした。入力欄の値を選択してコピーしてください。');
    }
  }

  return (
    <Card density="compact" id="mcp-connection" role="region" aria-labelledby="mcp-connection-title">
      <CardHeader>
        <CardTitle id="mcp-connection-title">MCP接続</CardTitle>
        <CardDescription>
          リモートMCP（OAuth）が有効なアカウントで利用できます。
          Museなどの接続先アプリでOAuthを選び、次のURLを登録してください。
          Slowthの認可画面で対象プロジェクトを選びます。
        </CardDescription>
      </CardHeader>
      <CardContent className={settingControlStack}>
        {CONNECTION_FIELDS.map(({ id, label, value, description, placeholder }) => (
          <div key={id} className={settingControlStack}>
            <Label htmlFor={id}>{label}</Label>
            <div className={settingActionRow}>
              <Input id={id} value={value} placeholder={placeholder} readOnly spellCheck={false} className="basis-full sm:flex-1"
                aria-describedby={description ? `${id}-description` : undefined}
                onFocus={(event) => event.currentTarget.select()} />
              {value && <Button type="button" variant="outline" size="sm" aria-label={`${label}をコピー`}
                onClick={() => void copy(id, value)}>
                {copiedId === id ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedId === id ? 'コピー済み' : 'コピー'}
              </Button>}
            </div>
            {description && <HelpText id={`${id}-description`}>{description}</HelpText>}
          </div>
        ))}
        <span className="sr-only" role="status" aria-live="polite">
          {copiedId ? `${CONNECTION_FIELDS.find(field => field.id === copiedId)?.label}をコピーしました。` : ''}
        </span>
        {copyError && <Prose role="alert">{copyError}</Prose>}
        <HelpText>
          APIキーを使うローカル版を利用する場合は、
          <a href="https://github.com/1000ri-jp/taskflow/blob/main/tools/slowth-mcp/README.md"
            target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            ローカルMCPの導入手順
          </a>
          を参照してください。設定例のファイルパスは、自分のPCに取得した場所へ置き換えます。
        </HelpText>
      </CardContent>
    </Card>
  );
}
