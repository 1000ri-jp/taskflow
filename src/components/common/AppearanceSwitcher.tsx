'use client';

import { useId } from 'react';
import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAppearanceStore, type Appearance } from '@/stores/appearanceStore';

const options: { value: Appearance; label: string; description: string; colors: string[] }[] = [
  { value: 'neo', label: 'Neo', description: '水色で軽やかに', colors: ['#ffffff', '#deeffc', '#226b98'] },
  { value: 'ivory', label: 'Ivory', description: '白と墨色で上品に', colors: ['#fffefb', '#33332f', '#b59961'] },
  { value: 'classic', label: 'クラシック', description: 'これまでの見た目', colors: ['#ffffff', '#e5e7eb', '#18181b'] },
];

export function AppearanceSwitcher() {
  const { appearance, setAppearance, persistenceError } = useAppearanceStore();
  const groupId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="デザイン" title="デザイン">
          <Palette className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] p-3" aria-label="デザインを選択">
        <fieldset className="space-y-1">
          <legend className="mb-2 text-sm font-medium">デザイン</legend>
          {options.map(option => (
            <label key={option.value} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
              <input
                type="radio"
                name={groupId}
                value={option.value}
                checked={appearance === option.value}
                onChange={() => setAppearance(option.value)}
                className="h-4 w-4 shrink-0 accent-current"
              />
              <span aria-hidden="true" className="grid h-8 w-8 shrink-0 grid-cols-3 overflow-hidden rounded-md border">
                {option.colors.map(color => <span key={color} style={{ backgroundColor: color }} />)}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block whitespace-nowrap text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {persistenceError && <p role="status" className="mt-2 text-xs text-muted-foreground">{persistenceError}</p>}
      </PopoverContent>
    </Popover>
  );
}
