'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { User } from 'firebase/auth';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import videos from '@/lib/help/videos.json';
import manual from '@/app/(dashboard)/help/manual.json';
import { settingSelect } from '@/components/ui/setting-field';
import { HelpText } from '@/components/ui/typography';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';

const guides = manual.text.split(/(?=^## \d{2} )/m).flatMap(text => {
  const heading = text.match(/^## (\d{2}) (.+)$/m);
  return heading ? [{ number: heading[1], title: `${heading[1]} ${heading[2]}`, text: text.replace(/^## [^\n]+\n*/, '').trim() }] : [];
});

function AuthenticatedVideo({ user, id, title, onRetry }: { user: User; id: string; title: string; onRetry: () => void }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    void (async () => {
      try {
        const token = isE2EMockAuthEnabled() ? 'taskflow-local-help-preview' : await user.getIdToken();
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
  const selected = videos.find(video => video.id === id);
  const guide = guides.find(item => item.number === (selected?.id.slice(0, 2) ?? id.replace('manual-', '')));
  const purpose = guide?.text.match(/^目的：.+$/m)?.[0];
  const steps = guide?.text.replace(/^目的：[^\n]+\n*/, '').trim();
  return <Card>
    <CardHeader><CardTitle>動画と手順</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <select aria-label="操作動画を選ぶ" className={settingSelect} value={id} onChange={event => setId(event.target.value)}>
        {videos.map(video => <option key={video.id} value={video.id}>{video.title}</option>)}
        {guides.filter(item => !videos.some(video => video.id.startsWith(item.number))).map(item => <option key={item.number} value={`manual-${item.number}`}>{item.title}（手順のみ）</option>)}
      </select>
      {purpose && <p>{purpose}</p>}
      {selected && (user ? <AuthenticatedVideo key={`${user.uid}:${id}:${attempt}`} user={user} id={id} title={selected.title} onRetry={() => setAttempt(value => value + 1)} /> : <p>動画を見るにはログインしてください。</p>)}
      {id === '09_google-connection' && <HelpText>初回認証と対象選択の実操作は、この動画には含まれていません。</HelpText>}
      {guide && <section aria-label={`${guide.title}の手順`} className="space-y-2">
        <h3 className="text-sm font-semibold">{guide.title}</h3>
        <div className="space-y-2 text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          h3: props => <h4 {...props} />,
          p: props => <p {...props} />,
          ol: props => <ol className="list-decimal pl-5" {...props} />,
          table: props => <div className="overflow-x-auto"><table {...props} /></div>,
          th: props => <th {...props} />,
          td: props => <td {...props} />,
        }}>{steps}</ReactMarkdown>
        </div>
      </section>}
    </CardContent>
  </Card>;
}
