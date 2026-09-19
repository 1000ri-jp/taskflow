import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaskAssignees } from './TaskViewFields';
import { viewTask } from '@/test/taskViewFixtures';

const assigneeIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const names = Object.fromEntries(assigneeIds.map(id => [id, `担当者${id}`]));
const task = viewTask({ assigneeIds });
const groupName = `担当者: ${assigneeIds.map(id => names[id]).join('、')}`;

describe('TaskAssignees visible avatar limit', () => {
  it.each([true, false])('preserves the existing default when compact is %s', compact => {
    render(<TaskAssignees task={task} names={names} iconOnly compact={compact} />);
    const group = screen.getByRole('group', { name: groupName });
    const expectedLimit = compact ? 2 : 4;
    expect(group.querySelectorAll('[data-slot="avatar"]')).toHaveLength(expectedLimit);
    expect(within(group).getByLabelText(`ほか${assigneeIds.length - expectedLimit}名`)).toHaveTextContent(`+${assigneeIds.length - expectedLimit}`);
  });

  it.each([true, false])('allows five avatars and retains the overflow count when compact is %s', compact => {
    const { rerender } = render(<TaskAssignees task={task} names={names} iconOnly compact={compact} maxVisible={5} />);
    const group = screen.getByRole('group', { name: groupName });
    expect(group.querySelectorAll('[data-slot="avatar"]')).toHaveLength(5);
    expect(within(group).getByLabelText('ほか2名')).toHaveTextContent('+2');
    expect(within(group).getByTitle('ほか2名: 担当者f、担当者g')).toBeVisible();
    rerender(<TaskAssignees task={viewTask({ assigneeIds: assigneeIds.slice(0, 5) })} names={names} iconOnly compact={compact} maxVisible={5} />);
    expect(screen.getByRole('group').querySelectorAll('[data-slot="avatar"]')).toHaveLength(5);
    expect(screen.queryByText('+2')).not.toBeInTheDocument();
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity])('falls back to the existing default for invalid limit %s', maxVisible => {
    render(<TaskAssignees task={task} names={names} iconOnly compact maxVisible={maxVisible} />);
    const group = screen.getByRole('group', { name: groupName });
    expect(group.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    expect(within(group).getByLabelText('ほか5名')).toHaveTextContent('+5');
  });
});
