import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionAvatar } from './CompanionAvatar';

describe('CompanionAvatar', () => {
  it('renders the Moai artwork for the assistant avatar', () => {
    const { container } = render(<CompanionAvatar label="モアイ" />);
    const image = container.querySelector('img');

    expect(screen.getByRole('img', { name: 'モアイ' })).toBeInTheDocument();
    expect(image).toHaveAttribute(
      'src',
      expect.stringContaining('moai-white.png'),
    );
    expect(image).toHaveStyle({
      width: '142.857%',
      height: '142.857%',
      left: '-21.429%',
      top: '-17.143%',
    });
  });
});
