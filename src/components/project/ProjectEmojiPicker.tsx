'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HelpText } from '@/components/ui/typography';
import { settingActionRow, settingChoiceRow, settingControlStack, settingSelectionRow } from '@/components/ui/setting-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  filterProjectEmojis, loadProjectEmojis, PROJECT_EMOJI_CATEGORIES,
  PROJECT_EMOJI_QUICK_CHOICES, type ProjectEmoji,
} from '@/lib/project-emojis';

const PAGE_SIZE = 80;
const INITIAL_CHOICES: ProjectEmoji[] = PROJECT_EMOJI_QUICK_CHOICES.map(item => ({ ...item, keywords: '', category: '' }));

export function ProjectEmojiPicker({ value, onChange, disabled = false }: {
  value: string;
  onChange: (emoji: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<ProjectEmoji[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(0);
  const matches = useMemo(() => filterProjectEmojis(catalog ?? INITIAL_CHOICES, query, category), [catalog, query, category]);
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const selected = catalog?.find(item => item.emoji === value)
    ?? PROJECT_EMOJI_QUICK_CHOICES.find(item => item.emoji === value);

  useEffect(() => {
    if (!open || catalog) return;
    let active = true;
    void loadProjectEmojis().then(items => {
      if (!active) return;
      setCatalog(items);
      setLoadState('ready');
    }).catch(() => {
      if (active) setLoadState('error');
    });
    return () => { active = false; };
  }, [open, catalog, loadAttempt]);

  function changePage(next: number) {
    setPage(next);
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  function emojiButton(item: { emoji: string; name: string }) {
    return (
      <Button key={item.emoji} type="button" size="emoji"
        variant={value === item.emoji ? 'secondary' : 'outline'}
        disabled={disabled}
        aria-label={`${item.emoji} ${item.name}`} aria-pressed={value === item.emoji}
        title={item.name} onClick={() => { onChange(item.emoji); setOpen(false); }}>
        <span aria-hidden="true">{item.emoji}</span>
      </Button>
    );
  }

  return (
    <div className={settingControlStack} role="group" aria-label="プロジェクトの絵文字">
      <Popover open={open} onOpenChange={next => {
        setOpen(next);
        if (next && !catalog) setLoadState('loading');
      }}>
        <div className={settingSelectionRow}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="project-icon" disabled={disabled}
              aria-label="絵文字アイコンを変更" title="絵文字アイコンを変更">
              <span aria-hidden="true">{value}</span>
            </Button>
          </PopoverTrigger>
          <div className={settingControlStack}>
            <HelpText className="min-w-0 break-words" aria-live="polite">選択中：{selected?.name ?? value}</HelpText>
            <HelpText>押して変更</HelpText>
          </div>
        </div>
        <PopoverContent align="start" side="bottom" collisionPadding={16} aria-label="絵文字アイコンを選択"
          className="w-80 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain"
          onOpenAutoFocus={event => {
            const choice = listRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
              ?? listRef.current?.querySelector<HTMLButtonElement>('button');
            if (choice) { event.preventDefault(); choice.focus(); }
          }}>
          <div className={settingControlStack}>
            <div className={settingControlStack}>
              <Label htmlFor={`${id}-search`}>絵文字を検索</Label>
              <Input id={`${id}-search`} type="search" value={query} disabled={disabled}
                placeholder="例：ねこ、花、仕事、🇯🇵" className="h-11"
                onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
                onChange={event => { setQuery(event.target.value); setCategory('all'); changePage(0); }} />
            </div>
            <Select value={category} disabled={disabled || !catalog} onValueChange={next => { setCategory(next); changePage(0); }}>
              <SelectTrigger aria-label="絵文字のカテゴリ" className="h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべてのカテゴリ</SelectItem>
                {PROJECT_EMOJI_CATEGORIES.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {loadState === 'error' && <div role="alert">
              <HelpText>絵文字を読み込めませんでした。</HelpText>
              <Button type="button" variant="outline" disabled={disabled} onClick={() => {
                setLoadState('loading');
                setLoadAttempt(attempt => attempt + 1);
              }}>再読み込み</Button>
            </div>}
            <HelpText role="status">{loadState === 'loading' ? '絵文字を読み込んでいます…'
              : `${matches.length.toLocaleString('ja-JP')}件${matches.length > 0 ? `・${page + 1} / ${pageCount}ページ` : ''}`}</HelpText>
            <div ref={listRef} className="max-h-56 overflow-y-auto overscroll-contain" aria-label="絵文字の候補">
              {matches.length ? <div className={settingChoiceRow}>
                {matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(emojiButton)}
              </div> : loadState !== 'loading' && <HelpText>一致する絵文字がありません。検索語を変えてください。</HelpText>}
            </div>
            {pageCount > 1 && <div className={settingActionRow}>
              <Button type="button" variant="outline" className="h-11" disabled={disabled || page === 0} onClick={() => changePage(page - 1)}>前へ</Button>
              <Button type="button" variant="outline" className="h-11" disabled={disabled || page + 1 >= pageCount} onClick={() => changePage(page + 1)}>次へ</Button>
            </div>}
            <HelpText>絵文字の見た目や表示対応は端末によって異なります。</HelpText>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
