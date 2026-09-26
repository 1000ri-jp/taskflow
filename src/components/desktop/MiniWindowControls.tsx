'use client';

import { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { useMiniWindowPreference } from '@/hooks/useMiniWindowPreference';
import { Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function MiniWindowControls({ compact = false }: { compact?: boolean }) {
  const { visible, setVisible } = useMiniWindowPreference();
  const toggleId = useId();
  const controls = <div className="space-y-3">
    <p>Miniの表示</p>
    <div className="flex items-center gap-2">
      <Switch id={toggleId} aria-label="Mac版Miniを別ウィンドウで表示" checked={visible} onCheckedChange={setVisible} />
      <label htmlFor={toggleId} className="text-sm font-medium">{visible ? 'ON' : 'OFF'}</label>
    </div>
    <p className="text-xs text-muted-foreground">Mac版Miniが必要です。Macのメニューバーの🗿をクリックしても表示を切り替えられます。右クリックの「常に最前面」をONにすると、ほかのウィンドウより手前に表示します。</p>
    <p className="text-xs text-muted-foreground">スイッチは、このブラウザから最後に指定した状態です。Mac側での変更は同期されません。反応しない場合はMac版Miniを起動してください。</p>
  </div>;
  if (!compact) return controls;
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs has-[>svg]:px-2"><Sun className="h-3.5 w-3.5" aria-hidden="true" />ミニ</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">{controls}</PopoverContent>
  </Popover>;
}
