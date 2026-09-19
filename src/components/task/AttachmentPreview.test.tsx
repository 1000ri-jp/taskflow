import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AttachmentPreview, AttachmentPreviewCompact } from './AttachmentPreview';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <span role="img" aria-label={alt} data-src={src} />,
}));
vi.mock('@/lib/firebase/storage', () => ({ formatFileSize: () => '1 KB' }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([
  ['task image', AttachmentPreview, 'image/png', 'sample.png'],
  ['task PDF', AttachmentPreview, 'application/pdf', 'sample.pdf'],
  ['task audio', AttachmentPreview, 'audio/mpeg', 'sample.mp3'],
  ['task video', AttachmentPreview, 'video/mp4', 'sample.mp4'],
  ['comment image', AttachmentPreviewCompact, 'image/png', 'sample.png'],
  ['comment PDF', AttachmentPreviewCompact, 'application/pdf', 'sample.pdf'],
  ['comment audio', AttachmentPreviewCompact, 'audio/mpeg', 'sample.mp3'],
  ['comment video', AttachmentPreviewCompact, 'video/mp4', 'sample.mp4'],
] as const)('opens and reopens %s with a named, described dialog and no accessibility errors', (_label, Preview, type, name) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  render(<StrictMode><Dialog open><DialogContent>
    <DialogTitle>タスク詳細</DialogTitle><DialogDescription>添付を確認します。</DialogDescription>
    <Preview id="attachment" name={name} url={`/samples/${name}`} type={type} size={1024} />
  </DialogContent></Dialog></StrictMode>);

  for (let attempt = 0; attempt < 2; attempt++) {
    const task = screen.getByRole('dialog', { name: 'タスク詳細' });
    const trigger = Preview === AttachmentPreviewCompact && type === 'image/png'
      ? within(task).getByRole('button', { name })
      : within(task).getByRole('link', { name: new RegExp(name.replace('.', '\\.')) });
    fireEvent.click(trigger);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    const preview = screen.getByRole('dialog', { name });
    expect(preview).toHaveAccessibleDescription('添付ファイルのプレビュー');
    expect(within(preview).getByRole('heading', { name })).toBeVisible();
    expect(within(preview).getByRole('link', { name: '新しいタブで開く' })).toHaveAttribute('href', `/samples/${name}`);
    fireEvent.click(within(preview).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument();
  }
});
