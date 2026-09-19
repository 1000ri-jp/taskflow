import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage } from './ChatMessage';
import type { AIMessage } from '@/types/ai';

const message = (content: string, role: AIMessage['role'] = 'assistant'): AIMessage => ({ id: 'reply', role, content, createdAt: new Date('2026-09-13T09:00:00Z') });

describe('ChatMessage readability', () => {
  it('renders the existing reply as headings, distinct lists and emphasis without changing its facts', () => {
    render(<ChatMessage message={message('状況を整理しました。\n\n### 📊 現在のワークロード\n\n全体で**22件**のタスクがあります。\n\n* **期限切れ:** 4件\n* **本日期限:** 3件\n\n### 最初に確認すること\n\n1. 原稿を確認する\n2. 入稿日を相談する\n\n---\n\n> 期限はまだ変更していません。')} />);
    expect(screen.getByRole('heading', { name: '📊 現在のワークロード', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('22件').tagName).toBe('STRONG');
    const lists = screen.getAllByRole('list');
    expect(within(lists[0]).getAllByRole('listitem').map(item => item.textContent)).toEqual(['期限切れ: 4件', '本日期限: 3件']);
    expect(lists[1].tagName).toBe('OL');
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByText('期限はまだ変更していません。').closest('blockquote')).not.toBeNull();
    expect(screen.getByTestId('chat-message-content').textContent).not.toContain('###');
  });

  it('keeps tables scrollable and renders task links, while preserving nested lists and code literally', () => {
    render(<ChatMessage message={message('| 項目 | 件数 |\n| --- | --- |\n| 未完了 | 22 |\n\n[タスクを開く](/projects/p/board?task=t)\n\n- 確認する\n  - 担当者の返答\n\n```text\n### 記号はコード内ではそのまま\n```')} />);
    expect(within(screen.getByRole('region', { name: '表（横にスクロールできます）' })).getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'タスクを開く' })).toHaveAttribute('href', '/projects/p/board?task=t');
    expect(screen.getByText('担当者の返答').closest('ul')?.parentElement?.tagName).toBe('LI');
    expect(screen.getByText('### 記号はコード内ではそのまま').closest('pre')).not.toBeNull();
  });

  it('does not execute raw HTML, unsafe links, or remote images in AI output', () => {
    render(<ChatMessage message={message('<script>alert(1)</script>\n\n[危険](javascript:alert%281%29)\n\n![図](https://example.com/tracker.png)\n\n[資料](https://example.com/document)')} />);
    expect(screen.getByTestId('chat-message-content').querySelector('script, img, iframe')).toBeNull();
    expect(screen.queryByRole('link', { name: '危険' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '資料' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: '図' })).toHaveAttribute('href', 'https://example.com/tracker.png');
  });

  it('preserves the user’s literal input instead of treating it as a formatted AI reply', () => {
    render(<ChatMessage message={message('### この記号を直して\n**この文章**', 'user')} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-message-content').textContent).toBe('### この記号を直して\n**この文章**');
  });

  it('can render a reply while streaming and retains the completed content', () => {
    const { rerender } = render(<ChatMessage message={message('')} isStreaming />);
    expect(screen.getByRole('status', { name: '返信を準備しています' })).toBeInTheDocument();
    rerender(<ChatMessage message={message('### 状況\n\n**22')} isStreaming />);
    expect(screen.getByRole('heading', { name: '状況' })).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-content')).toHaveAttribute('aria-busy', 'true');
    rerender(<ChatMessage message={message('### 状況\n\n**22件**')} />);
    expect(screen.getByText('22件').tagName).toBe('STRONG');
    expect(screen.getByTestId('chat-message-content')).toHaveAttribute('aria-busy', 'false');
  });
});


afterEach(() => vi.unstubAllGlobals());
it('copies only the selected code block verbatim, including indentation and newlines', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', {clipboard:{writeText}});
  const json = '{\n  "strengths": ["最上志向", "調和性"]\n}\n';
  render(<ChatMessage message={message('前の説明\n\n```json\n'+json+'```\n\n```text\n別のブロック\n```\n\n後の説明')} />);
  fireEvent.click(screen.getAllByRole('button',{name:'コードをコピー'})[0]);
  expect(await screen.findByText('コピーしました')).toHaveClass('sr-only');
  expect(writeText).toHaveBeenCalledExactlyOnceWith(json);
  fireEvent.click(screen.getAllByRole('button',{name:'コードをコピー'})[1]);
  await screen.findAllByText('コピーしました');
  expect(writeText).toHaveBeenLastCalledWith('別のブロック\n');
});
it('reports clipboard failure and allows retry without claiming success', async () => {
  const writeText=vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
  vi.stubGlobal('navigator',{clipboard:{writeText}});
  render(<ChatMessage message={message('```text\nコピー対象\n```')} />);
  fireEvent.click(screen.getByRole('button',{name:'コードをコピー'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('コピーできませんでした');
  expect(screen.queryByText('コピーしました')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'コードをコピー'}));
  expect(await screen.findByText('コピーしました')).toHaveClass('sr-only');
  expect(writeText).toHaveBeenCalledTimes(2);
});
