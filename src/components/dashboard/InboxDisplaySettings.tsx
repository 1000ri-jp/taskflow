'use client';

import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useInboxDisplayStore, type InboxDisplaySettings as Settings } from '@/stores/inboxDisplayStore';

const options: { key: keyof Settings; label: string; status: string }[] = [
  { key: 'gmail', label: 'Gmail', status: '表示サンプル' },
  { key: 'comments', label: 'コメント', status: '実データ・読み取り専用' },
  { key: 'googleChat', label: 'Google Chat', status: '未連携' },
];

export function InboxDisplaySettings() {
  const { settings, setOption, reset } = useInboxDisplayStore();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" aria-label="受信箱の表示設定">
          <SlidersHorizontal className="h-3.5 w-3.5" />表示設定
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] space-y-3" align="end">
        <p className="text-sm font-medium">受信箱に表示するもの</p>
        <div className="space-y-1">
          {options.map(({ key, label, status }) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-muted">
              <Checkbox aria-label={label} checked={settings[key]} onCheckedChange={(checked) => setOption(key, checked === true)} />
              <span className="text-sm">{label}</span>
              <span className="ml-auto text-xs text-muted-foreground">{status}</span>
            </label>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          選択はこのブラウザだけに保存します。コメントは読み取り専用で取得します。送信・既読化は行いません。
        </p>
        <Button variant="ghost" size="sm" className="w-full" onClick={reset}>初期設定に戻す</Button>
      </PopoverContent>
    </Popover>
  );
}
