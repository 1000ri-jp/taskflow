'use client';

import { useState } from 'react';
import { ExternalLink, Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { ProjectUrl } from '@/types';

interface ProjectUrlsBarProps {
  urls: ProjectUrl[];
  onAddUrl: (url: ProjectUrl) => Promise<void>;
  onEditUrl: (urlId: string, data: Partial<ProjectUrl>) => Promise<void>;
  onRemoveUrl: (urlId: string) => Promise<void>;
}

export function ProjectUrlsBar({
  urls,
  onAddUrl,
  onEditUrl,
  onRemoveUrl,
}: ProjectUrlsBarProps) {
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [newUrlTitle, setNewUrlTitle] = useState('');
  const [newUrlValue, setNewUrlValue] = useState('');
  const [editingUrlId, setEditingUrlId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editValue, setEditValue] = useState('');

  const handleAddUrl = async () => {
    if (!newUrlTitle.trim() || !newUrlValue.trim()) return;

    const newUrl: ProjectUrl = {
      id: Date.now().toString(),
      title: newUrlTitle.trim(),
      url: newUrlValue.trim(),
    };

    await onAddUrl(newUrl);
    setNewUrlTitle('');
    setNewUrlValue('');
    setIsAddingUrl(false);
  };

  const handleStartEdit = (url: ProjectUrl) => {
    setEditingUrlId(url.id);
    setEditTitle(url.title);
    setEditValue(url.url);
  };

  const handleSaveEdit = async () => {
    if (!editingUrlId || !editTitle.trim() || !editValue.trim()) return;

    await onEditUrl(editingUrlId, {
      title: editTitle.trim(),
      url: editValue.trim(),
    });
    setEditingUrlId(null);
    setEditTitle('');
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingUrlId(null);
    setEditTitle('');
    setEditValue('');
  };

  if (urls.length === 0 && !isAddingUrl) {
    return (
      <div className="mb-4 flex items-center gap-2">
        <Popover open={isAddingUrl} onOpenChange={setIsAddingUrl}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <Plus className="mr-1 h-3 w-3" />
              URLを追加
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <div className="space-y-3">
              <div className="text-sm font-medium">URLを追加</div>
              <Input
                value={newUrlTitle}
                onChange={(e) => setNewUrlTitle(e.target.value)}
                placeholder="タイトル（例: デザインファイル）"
                autoFocus
              />
              <Input
                value={newUrlValue}
                onChange={(e) => setNewUrlValue(e.target.value)}
                placeholder="URL（例: https://figma.com/...）"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    handleAddUrl();
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsAddingUrl(false);
                    setNewUrlTitle('');
                    setNewUrlValue('');
                  }}
                >
                  キャンセル
                </Button>
                <Button size="sm" onClick={handleAddUrl}>
                  追加
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {urls.map((url) => (
        <div
          key={url.id}
          className="group relative flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted"
        >
          <a
            href={url.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[150px] truncate underline">{url.title}</span>
          </a>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Popover
              open={editingUrlId === url.id}
              onOpenChange={(open) => {
                if (open) {
                  handleStartEdit(url);
                } else {
                  handleCancelEdit();
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  className="rounded p-0.5 hover:bg-muted-foreground/20"
                  title="編集"
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80">
                <div className="space-y-3">
                  <div className="text-sm font-medium">URLを編集</div>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="タイトル"
                    autoFocus
                  />
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder="URL"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        handleSaveEdit();
                      }
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                      キャンセル
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit}>
                      保存
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <button
              className="rounded p-0.5 hover:bg-red-100"
              onClick={() => onRemoveUrl(url.id)}
              title="削除"
            >
              <Trash2 className="h-3 w-3 text-red-500" />
            </button>
          </div>
        </div>
      ))}

      <Popover open={isAddingUrl} onOpenChange={setIsAddingUrl}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full border border-dashed"
          >
            <Plus className="mr-1 h-3 w-3" />
            URLを追加
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <div className="space-y-3">
            <div className="text-sm font-medium">URLを追加</div>
            <Input
              value={newUrlTitle}
              onChange={(e) => setNewUrlTitle(e.target.value)}
              placeholder="タイトル（例: デザインファイル）"
              autoFocus
            />
            <Input
              value={newUrlValue}
              onChange={(e) => setNewUrlValue(e.target.value)}
              placeholder="URL（例: https://figma.com/...）"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  handleAddUrl();
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAddingUrl(false);
                  setNewUrlTitle('');
                  setNewUrlValue('');
                }}
              >
                キャンセル
              </Button>
              <Button size="sm" onClick={handleAddUrl}>
                追加
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
