'use client';

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import videos from '@/lib/help/videos.json';
import { settingSelect } from '@/components/ui/setting-field';
import { HelpText } from '@/components/ui/typography';

function AuthenticatedVideo({ user, id, title, onRetry }: { user: User; id: string; title: string; onRetry: () => void }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/help/videos/${id}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('動画を読み込めませんでした。ログイン状態と接続を確認して、再試行してください。');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '動画を読み込めませんでした。');
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, user]);
  if (error) return <div><p role="alert">{error}</p><Button variant="outline" onClick={onRetry}>再試行</Button></div>;
  if (!src) return <p role="status">動画を読み込んでいます…</p>;
  return <video aria-label={title} className="w-full" controls playsInline preload="metadata" src={src} onError={() => setError('動画を再生できませんでした。再試行してください。')} />;
}

export function HelpVideos() {
  const user = useAuthStore(state => state.firebaseUser);
  const [id, setId] = useState(videos[0].id);
  const [attempt, setAttempt] = useState(0);
  const selected = videos.find(video => video.id === id) ?? videos[0];
  return <Card>
    <CardHeader><CardTitle>動画で見る</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <label className="block">操作を選ぶ
        <select aria-label="操作動画を選ぶ" className={settingSelect} value={id} onChange={event => setId(event.target.value)}>
          {videos.map(video => <option key={video.id} value={video.id}>{video.title}</option>)}
        </select>
      </label>
      {user ? <AuthenticatedVideo key={`${user.uid}:${id}:${attempt}`} user={user} id={id} title={selected.title} onRetry={() => setAttempt(value => value + 1)} /> : <p>動画を見るにはログインしてください。</p>}
      <HelpText>全13本・各30秒以内。2026年9月20日の画面で撮影しています。最近の変更は下の手順をご覧ください。</HelpText>
      {id === '09_google-connection' && <HelpText>初回認証と対象選択の実操作は、この動画には含まれていません。</HelpText>}
    </CardContent>
  </Card>;
}
