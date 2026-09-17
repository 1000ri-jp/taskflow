'use client';

import { AutoArchiveSettings } from './AutoArchiveSettings';

/** Keep existing project-settings imports while server settings replace the browser-only preview. */
export function AutoArchivePreviewSettings({ projectId }: { projectId: string }) {
  return <AutoArchiveSettings projectId={projectId} />;
}
