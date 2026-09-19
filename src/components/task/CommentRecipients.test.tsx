import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommentRecipients } from './CommentRecipients';
const members = { users: Array.from({ length: 7 }, (_, i) => ({ id: String(i), displayName: `Member ${i}` })), isLoading: false, hasError: false, refresh: vi.fn() };
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => vi.unstubAllGlobals());
function Example({ disabled = false }: { disabled?: boolean }) {
  const [selected, onChange] = useState<string[]>([]);
  return <CommentRecipients label="通知先" members={members} selected={selected} onChange={onChange} frequentIds={['6', '5']} disabled={disabled} />;
}
it('shows up to five frequent members, selects others through search, and preserves the selection after closing', () => {
  render(<Example />);
  expect(screen.getAllByRole('checkbox').map(el => el.getAttribute('aria-label'))).toEqual(['Member 6', 'Member 5', 'Member 0', 'Member 1', 'Member 2']);
  expect(screen.queryByRole('checkbox', { name: 'Member 4' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '通知先をほかのメンバーから選ぶ' }));
  const popup = screen.getByRole('dialog', { name: '通知先のメンバー選択' });
  fireEvent.change(within(popup).getByRole('textbox'), { target: { value: 'Member 4' } });
  expect(within(popup).getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.click(within(popup).getByRole('checkbox', { name: 'Member 4' }));
  fireEvent.keyDown(within(popup).getByRole('textbox'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '通知先をほかのメンバーから選ぶ' })).toHaveTextContent('他 1人選択');
  fireEvent.click(screen.getByRole('button', { name: '通知先をほかのメンバーから選ぶ' }));
  expect(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Member 4' })).toBeChecked();
});
it('closes portal controls when a submission locks the composer', () => {
  const view = render(<Example />);
  fireEvent.click(screen.getByRole('button', { name: '通知先をほかのメンバーから選ぶ' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  view.rerender(<Example disabled />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getAllByRole('checkbox').every(el => (el as HTMLInputElement).disabled)).toBe(true);
  expect(screen.getByRole('button', { name: '通知先をほかのメンバーから選ぶ' })).toBeDisabled();
});
it('distinguishes member failure from an empty member list and offers a retry', () => {
  const view = render(<CommentRecipients label="通知先" members={{ ...members, hasError: true }} selected={[]} onChange={vi.fn()} frequentIds={[]} disabled={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent('取得できません');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(members.refresh).toHaveBeenCalledOnce();
  view.rerender(<CommentRecipients label="通知先" members={{ ...members, users: [] }} selected={[]} onChange={vi.fn()} frequentIds={[]} disabled={false} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('選択できるメンバーがいません。')).toBeVisible();
});
