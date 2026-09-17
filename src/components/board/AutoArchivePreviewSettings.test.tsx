import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AutoArchivePreviewSettings } from './AutoArchivePreviewSettings';

vi.mock('./AutoArchiveSettings', () => ({ AutoArchiveSettings: ({ projectId }: { projectId: string }) => <div data-testid="auto-archive-settings" data-project-id={projectId} /> }));
it('keeps the old project settings import connected to the server-backed form', () => {
  render(<AutoArchivePreviewSettings projectId="project-1" />);
  expect(screen.getByTestId('auto-archive-settings')).toHaveAttribute('data-project-id', 'project-1');
});
