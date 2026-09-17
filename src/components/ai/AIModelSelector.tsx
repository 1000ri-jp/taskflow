'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AI_MODEL_OPTIONS } from '@/lib/ai/modelOptions';
import type { AIProviderType } from '@/types/ai';

interface AIModelSelectorProps {
  provider: AIProviderType;
  model: string;
  defaultModel: string;
  onChange: (model: string) => void;
}

const CUSTOM_OPTION = '__custom_model__';

export function AIModelSelector(props: AIModelSelectorProps) {
  // Discard an unfinished draft when the provider or saved choice changes (including another tab).
  return <ModelSelectorFields key={`${props.provider}:${props.model}`} {...props} />;
}

function ModelSelectorFields({ provider, model, defaultModel, onChange }: AIModelSelectorProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  const options = [...AI_MODEL_OPTIONS[provider]];
  for (const value of [defaultModel, model]) {
    if (value && !options.some((option) => option.id === value)) {
      options.push({ id: value, label: value });
    }
  }
  const trimmedDraft = draft.trim();
  const validDraft = trimmedDraft.length > 0 && !/\s/.test(trimmedDraft) && trimmedDraft !== CUSTOM_OPTION;
  const applyDraft = () => {
    if (!validDraft) return;
    onChange(trimmedDraft);
    setEditing(false);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-model`}>モデル</Label>
        <select
          id={`${id}-model`}
          value={editing ? CUSTOM_OPTION : model}
          aria-describedby={`${id}-help`}
          className="border-input bg-background flex h-9 w-full min-w-0 rounded-md border px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onChange={(event) => {
            if (event.target.value === CUSTOM_OPTION) {
              setDraft(model);
              setEditing(true);
            } else {
              setEditing(false);
              onChange(event.target.value);
            }
          }}
        >
          {!model && <option value="" disabled>モデルを選択</option>}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}{option.id === defaultModel ? '（デフォルト）' : ''}
            </option>
          ))}
          <option value={CUSTOM_OPTION}>モデルIDを指定…</option>
        </select>
      </div>

      {editing && (
        <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor={`${id}-custom`}>モデルID</Label>
          <Input
            id={`${id}-custom`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                applyDraft();
              }
            }}
            placeholder="利用するモデルのIDを入力"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-custom-help`}
          />
          <p id={`${id}-custom-help`} className="text-xs text-muted-foreground">
            一覧にないモデルは、提供元のモデルIDを入力して適用します。
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={applyDraft} disabled={!validDraft}>適用</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>キャンセル</Button>
          </div>
        </div>
      )}

      <div id={`${id}-help`} className="space-y-1 text-xs text-muted-foreground">
        <p>選択するとこのブラウザに保存され、次のAI操作から使われます。</p>
        <p className="break-all">使用中: {model || '未選択'}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => { setEditing(false); onChange(defaultModel); }}
        disabled={model === defaultModel}
      >
        デフォルトに戻す
      </Button>
    </div>
  );
}
