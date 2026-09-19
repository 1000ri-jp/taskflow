'use client';

import { LIST_COLORS } from '@/types';
import { cn } from '@/lib/utils';

const colorNames: Record<typeof LIST_COLORS[number]['name'], string> = {
  slate: 'グレー', red: '赤', orange: 'オレンジ', amber: '黄', green: '緑',
  teal: '青緑', blue: '青', indigo: '藍', purple: '紫', pink: 'ピンク',
};

export function ListColorPalette({ value, onChange, label }: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  return <div role="group" aria-label={label} className="flex max-w-40 flex-wrap gap-2">
    {LIST_COLORS.map(color => <button
      key={color.value}
      type="button"
      aria-label={colorNames[color.name]}
      aria-pressed={value.toLowerCase() === color.value}
      title={colorNames[color.name]}
      onClick={() => onChange(color.value)}
      className={cn('h-6 w-6 rounded-full transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', value.toLowerCase() === color.value && 'ring-2 ring-offset-1 ring-primary')}
      style={{ backgroundColor: color.value }}
    />)}
  </div>;
}
