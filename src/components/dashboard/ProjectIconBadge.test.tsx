import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectIconBadge } from './ProjectIconBadge';

describe('ProjectIconBadge', () => {
  it.each([
    ['high', 'rgb(185, 28, 28)'],
    ['medium', 'rgb(161, 98, 7)'],
    ['low', 'rgb(71, 85, 105)'],
    [null, 'rgb(31, 31, 31)'],
  ] as const)('uses the priority background for %s', (priority, backgroundColor) => {
    render(<ProjectIconBadge icon="🎯" priority={priority} />);
    expect(screen.getByText('🎯')).toHaveStyle({ backgroundColor });
  });

  it('keeps the fallback emoji slot when no project icon is configured', () => {
    render(<ProjectIconBadge priority={null} />);
    expect(screen.getByText('TF')).toHaveClass('bg-neutral-900', 'text-white');
  });
});
