import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssigneeSelector } from './AssigneeSelector';
import { getUsersByIds } from '@/lib/firebase/firestore';

vi.mock('@/lib/firebase/firestore', () => ({ getUsersByIds: vi.fn() }));
const people = [
  { id: 'a', displayName: 'Kozue Kato', photoURL: 'https://example.test/kozue.png' },
  { id: 'b', displayName: 'Kaori' },
  { id: 'c', displayName: 'Nao' },
  { id: 'd', displayName: 'Rira' },
  { id: 'e', displayName: 'Ciel' },
];
const memberIds = people.map(person => person.id);
const update = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  // Radix preloads images through Image; no image/network service is used here.
  vi.stubGlobal('Image', class extends EventTarget { src = ''; complete = true; naturalWidth = 1; });
  vi.mocked(getUsersByIds).mockImplementation(async ids => people.filter(person => ids.includes(person.id)) as Awaited<ReturnType<typeof getUsersByIds>>);
});
afterEach(() => vi.unstubAllGlobals());

function selector(assigneeIds: string[]) {
  return <AssigneeSelector compact membersOverride={people} assigneeIds={assigneeIds} projectMemberIds={memberIds} onUpdate={update} />;
}

describe('AssigneeSelector compact people', () => {
  it('shows the configured photo and initials with the actual assignee names', async () => {
    render(selector(['a', 'b']));
    const trigger = screen.getByRole('button', { name: '担当者（2人）: Kozue Kato、Kaori' });
    expect(await within(trigger).findByAltText('Kozue Kato')).toHaveAttribute('src', people[0].photoURL);
    expect(within(trigger).getByTitle('Kaori')).toHaveTextContent('K');
    expect(trigger.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    expect(getUsersByIds).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('retains an unresolved member in the count with a visible fallback and accessible explanation', () => {
    render(selector(['b', 'missing']));
    const trigger = screen.getByRole('button', { name: '担当者（2人）: Kaori、名前を確認できないメンバー' });
    expect(within(trigger).getByTitle('名前を確認できないメンバー')).toHaveTextContent('?');
    expect(trigger.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '担当者を追加' })).not.toBeInTheDocument();
  });
  it('bounds the avatar stack while keeping every assignee in its accessible name', () => {
    render(selector(memberIds));
    const trigger = screen.getByRole('button', { name: '担当者（5人）: Kozue Kato、Kaori、Nao、Rira、Ciel' });
    expect(trigger.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3);
    expect(within(trigger).getByText('+2')).toBeVisible();
  });
  it('keeps the empty add control and existing selection updates through the same popover', () => {
    function Example() {
      const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
      return <AssigneeSelector compact membersOverride={people} assigneeIds={assigneeIds} projectMemberIds={memberIds} onUpdate={ids => { update(ids); setAssigneeIds(ids); }} />;
    }
    render(<Example />);
    const add = screen.getByRole('button', { name: '担当者を追加' });
    expect(add.querySelectorAll('[data-slot="avatar"]')).toHaveLength(0);
    fireEvent.click(add);
    fireEvent.click(within(screen.getByRole('dialog', { name: '担当者を選択' })).getByRole('button', { name: /Kaori/ }));
    expect(update).toHaveBeenLastCalledWith(['b']);
    expect(screen.getByRole('button', { name: '担当者（1人）: Kaori' })).toHaveTextContent('K');
    fireEvent.click(within(screen.getByRole('dialog', { name: '担当者を選択' })).getByRole('button', { name: /Kaori/ }));
    expect(update).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole('button', { name: '担当者を追加' })).toBeInTheDocument();
  });
  it('resolves existing assigned IDs from the same user lookup used by the selector', async () => {
    render(<AssigneeSelector compact assigneeIds={['a', 'b']} projectMemberIds={memberIds} onUpdate={update} />);
    const trigger = await screen.findByRole('button', { name: '担当者（2人）: Kozue Kato、Kaori' });
    expect(await within(trigger).findByAltText('Kozue Kato')).toHaveAttribute('src', people[0].photoURL);
    expect(getUsersByIds).toHaveBeenCalledWith(['a', 'b']);
    expect(update).not.toHaveBeenCalled();
  });
  it('preserves named chips and direct removal in the default noncompact view', () => {
    render(<AssigneeSelector compact={false} membersOverride={people} assigneeIds={['b']} projectMemberIds={memberIds} onUpdate={update} />);
    const chip = screen.getByText('Kaori').parentElement!;
    expect(chip).toHaveTextContent('Kaori');
    fireEvent.click(within(chip).getByRole('button'));
    expect(update).toHaveBeenCalledWith([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
