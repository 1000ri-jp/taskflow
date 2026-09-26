'use client';
import { SettingsLayout } from '@/components/ui/screen-layouts';
import { PageHeading } from '@/components/ui/typography';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Bot, ChevronRight, Key } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { CommentStampSettings } from '@/components/task/CommentStampSettings';
import { SecretaryRefreshSettings } from '@/components/secretary/SecretaryRefreshSettings';
import { DashboardViewSettings } from '@/components/dashboard/DashboardViewSettings';
import { AutoArchiveSettings } from '@/components/board/AutoArchiveSettings';
import { MiniWindowControls } from '@/components/desktop/MiniWindowControls';
import { CompanionScheduleSettings } from '@/components/ai/CompanionScheduleSettings';

export default function SettingsPage() {
  const userId = useAuthStore(state => state.user?.id);
  return (
    <SettingsLayout>
      <div>
        <PageHeading>設定</PageHeading>
        <p className="text-muted-foreground">アプリケーションの設定を管理します</p>
      </div>

      <Card density="compact" id="dashboard-view">
        <CardHeader><CardTitle>ダッシュボード</CardTitle><CardDescription>旧版・新版・Neoを選びます。外観とカレンダーの選択は引き継ぎます。</CardDescription></CardHeader>
        <CardContent><DashboardViewSettings /></CardContent>
      </Card>

      <Card density="compact" id="mini">
        <CardHeader><CardTitle>TaskSlowth Mini</CardTitle><CardDescription>Macの別ウィンドウに表示します。</CardDescription></CardHeader>
        <CardContent><MiniWindowControls /></CardContent>
      </Card>

      {userId && <CompanionScheduleSettings key={`companion-schedule:${userId}`} userId={userId} />}

      {userId && <Card density="compact" id="comment-stamps">
        <CardHeader><CardTitle>見たよのスタンプ</CardTitle></CardHeader>
        <CardContent><CommentStampSettings key={userId} userId={userId} /></CardContent>
      </Card>}

      {userId && <AutoArchiveSettings key={`auto-archive:${userId}`} />}

      <Card density="compact">
        <CardHeader>
          <CardTitle>ブラウザ保存データ</CardTitle>
          <CardDescription>このブラウザだけに保存した表示設定や下書きを、一覧・JSONに書き出します。</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/browser-backup">
            <Button variant="outline" className="w-full justify-between">
              保存内容を確認・書き出し
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {userId && <Card density="compact">
        <CardHeader>
          <CardTitle>AI秘書の取得設定</CardTitle>
          <CardDescription>Neoでタスク・コメントを確認する間隔を変更します。</CardDescription>
        </CardHeader>
        <CardContent><SecretaryRefreshSettings userId={userId} /></CardContent>
      </Card>}

      <Card density="compact">
        <CardHeader><CardTitle>Google連携</CardTitle><CardDescription>カレンダー・Gmail・Google Chatの接続と取得範囲を設定します。</CardDescription></CardHeader>
        <CardContent><Link href="/settings/google"><Button variant="outline" className="w-full justify-between">Google連携を開く<ChevronRight className="h-4 w-4" /></Button></Link></CardContent>
      </Card>

      {/* AI Settings */}
      <Card density="compact">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI設定
          </CardTitle>
          <CardDescription>
            AIアシスタントのプロバイダーとAPIキーを設定します
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/ai">
            <Button variant="outline" className="w-full justify-between">
              AI設定を開く
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card density="compact">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            APIキー管理
          </CardTitle>
          <CardDescription>
            外部のAIやツール（MCP）からTaskFlowにアクセスするためのAPIキーを管理します
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/api-keys">
            <Button variant="outline" className="w-full justify-between">
              APIキー管理を開く
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Language */}
      <Card density="compact">
        <CardHeader>
          <CardTitle>言語・地域</CardTitle>
          <CardDescription>
            言語とタイムゾーンを設定します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>言語</Label>
              <p className="text-sm text-muted-foreground">
                アプリケーションの表示言語
              </p>
            </div>
            <span className="text-sm">日本語</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>タイムゾーン</Label>
              <p className="text-sm text-muted-foreground">
                日時の表示に使用するタイムゾーン
              </p>
            </div>
            <span className="text-sm">Asia/Tokyo (JST)</span>
          </div>
        </CardContent>
      </Card>
    </SettingsLayout>
  );
}
