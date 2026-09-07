import { describe, expect, it, vi } from 'vitest';
import { BACKUP_KEYS, backupMarkdown, collectBrowserBackup } from './browser-backup';

describe('browser backup', () => {
  it('reads only the explicit allowlist and retains exact local values including legacy values', () => {
    const data: Record<string, string> = {
      'taskflow.upcomingRange.v1': '5', 'companionAIPanelOpen': 'false',
      'taskflow.meetLink.v1': 'null', 'taskflow.targetProjects.v1': '[]',
      'taskflow.targetGoals.v1': '[{"id":"goal-1","targetCount":3}]',
      'taskflow.meetingProposalReview.v1': '{ "old": true }',
      'ai-settings-storage': 'secret-not-to-read', 'firebase:authUser': 'secret-not-to-read',
    };
    const read = vi.fn((key: string) => data[key] ?? null);
    const result = collectBrowserBackup(read, 'http://localhost:3002', new Date('2026-09-03T00:00:00Z'));
    expect(read.mock.calls.map(c => c[0])).toEqual(BACKUP_KEYS.map(([key]) => key));
    expect(result.exportedAt).toBe('2026-09-03T00:00:00.000Z');
    for (const key of Object.keys(data).filter(k => k.startsWith('taskflow.') || k === 'companionAIPanelOpen')) {
      expect(result.entries.find(e => e.key === key)).toMatchObject({ status: 'saved', raw: data[key] });
    }
    expect(result.entries.find(e => e.key === 'taskflow.boardDisplay.v1')).toMatchObject({ status: 'missing' });
    expect(JSON.stringify(result)).not.toContain('secret-not-to-read');
  });
  it('keeps malformed raw values without repair and distinguishes read failures', () => {
    const result = collectBrowserBackup(key => {
      if (key === 'taskflow.boardDisplay.v1') throw new Error('private details');
      if (key === 'taskflow.targetTasks.v1') return '{broken';
      if (key === 'companionAIPanelOpen') return '';
      return null;
    }, 'http://localhost:3002');
    expect(result.entries[0]).toMatchObject({ status: 'read-error' });
    expect(result.entries.find(e => e.key === 'taskflow.targetTasks.v1')).toMatchObject({ status: 'invalid-json', raw: '{broken' });
    expect(result.entries.find(e => e.key === 'companionAIPanelOpen')).toMatchObject({ status: 'invalid-json', raw: '' });
    expect(JSON.stringify(result)).not.toContain('private details');
  });
  it.each(['{"password":"private-value"}', '{"note":"API key: private-value"}', '{"apiKey":"private-value"}', '{"note":"Bearer private-value"}'])('excludes obvious sensitive content: %s', raw => {
    const result = collectBrowserBackup(key => key === 'taskflow.meetingProposalReview.v2' ? raw : null, 'http://localhost:3002');
    expect(result.entries.find(e => e.key === 'taskflow.meetingProposalReview.v2')).toMatchObject({ status: 'excluded-sensitive' });
    expect(JSON.stringify(result)).not.toContain('private-value');
  });
  it('creates readable counts and safely fenced values without applying any defaults', () => {
    const result = collectBrowserBackup(key => key === 'taskflow.meetingChecklistDraft.v1' ? JSON.stringify({ placements: { a: { title: '```注記' } }, items: { a: { checked: true } } }) : null, 'http://localhost:3002');
    const md = backupMarkdown(result);
    expect(md).toContain('配置 1件、チェック項目 1件');
    expect(md).toContain('出力した保存項目：1件');
    expect(md).toContain('````json');
    expect(md).toContain('保存なし');
  });
});
