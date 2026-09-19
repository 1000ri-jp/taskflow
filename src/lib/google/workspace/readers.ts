import unescape from 'lodash/unescape';
import { MAX_UPCOMING_DAYS } from '@/lib/dashboard/upcoming-range';
import { googleJson, GoogleWorkspaceError } from './security';
import { googleSelections, MAX_GOOGLE_SELECTIONS, type GoogleItem, type GoogleSelection, type GoogleService } from './types';
import type { Connection } from './oauth';

const clip = (s: string | undefined, max: number) => (s ?? '').slice(0, max);
export async function readGoogleItems(service: GoogleService, token: string, connection: Connection, now = new Date(), calendarRange?: { start: Date; end: Date }): Promise<{ items: GoogleItem[]; partial: boolean }> {
  const headers = { Authorization: `Bearer ${token}` };
  const selected = googleSelections(connection, service).slice(0, MAX_GOOGLE_SELECTIONS);
  if (!selected.length) return { items: [], partial: false };
  if (service === 'calendar') {
    const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    const start = calendarRange?.start ?? new Date(`${day}T00:00:00+09:00`);
    // Include today plus the legacy dashboard's full tomorrow-forward range.
    const end = calendarRange?.end ?? new Date(start.getTime() + (MAX_UPCOMING_DAYS + 1) * 86400000);
    const perCalendarLimit = calendarRange ? 250 : 100;
    const combinedLimit = calendarRange ? 500 : 100;
    const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: String(perCalendarLimit),
      fields: 'items(id,summary,start,end,status,htmlLink,eventType,workingLocationProperties(type)),nextPageToken' });
    let partial = false; let succeeded = 0;
    const items: GoogleItem[] = [];
    for (const calendar of selected) {
      try {
        const data = await googleJson<{ items?: { id: string; summary?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; status?: string; htmlLink?: string; eventType?: string; workingLocationProperties?: { type?: string } }[]; nextPageToken?: string }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params}`, { headers });
        succeeded++; if (data.nextPageToken || (data.items?.length ?? 0) > perCalendarLimit) partial = true;
        for (const e of (data.items ?? []).slice(0, perCalendarLimit)) {
          if (e.status === 'cancelled') continue;
          const at = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00+09:00` : '');
          const until = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00+09:00` : '');
          if (!e.id || !at || !until || !Number.isFinite(Date.parse(at)) || !Number.isFinite(Date.parse(until))) { partial = true; continue; }
          items.push({ id: `${encodeURIComponent(calendar.id)}:${e.id}`, title: clip(e.summary, 300) || '（タイトルなし）', text: '', at, end: until, allDay: !!e.start?.date,
            ...(typeof e.eventType === 'string' ? { eventType: e.eventType } : {}),
            ...(typeof e.workingLocationProperties?.type === 'string' ? { workingLocationProperties: { type: e.workingLocationProperties.type } } : {}),
            url: e.htmlLink?.startsWith('https://www.google.com/calendar/') || e.htmlLink?.startsWith('https://calendar.google.com/') ? e.htmlLink : 'https://calendar.google.com/', sourceName: calendar.name });
        }
      } catch { partial = true; }
    }
    if (!succeeded) throw new GoogleWorkspaceError('GOOGLE_UNAVAILABLE', 'カレンダーを取得できませんでした。権限・取得対象を確認してください。前回の情報を保持しています。');
    return { items: items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)).slice(0, combinedLimit), partial: partial || items.length > combinedLimit };
  }
  if (service === 'gmail') {
    const messageIds = new Set<string>(); let partial = false; let succeeded = 0;
    // Separate label queries give a union (labelIds combined in one request means AND).
    for (const label of selected) {
      try {
        const params = new URLSearchParams({ labelIds: label.id, q: 'newer_than:7d', maxResults: '20', fields: 'messages(id),nextPageToken',
          ...(label.id === 'SPAM' || label.id === 'TRASH' ? { includeSpamTrash: 'true' } : {}) });
        const data = await googleJson<{ messages?: { id: string }[]; nextPageToken?: string }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { headers });
        succeeded++; if (data.nextPageToken || (data.messages?.length ?? 0) > 20) partial = true;
        for (const message of (data.messages ?? []).slice(0, 20)) messageIds.add(message.id);
      } catch { partial = true; }
    }
    if (!succeeded) throw new GoogleWorkspaceError('GOOGLE_UNAVAILABLE', 'メールを取得できませんでした。権限・取得対象を確認してください。前回の情報を保持しています。');
    const items: GoogleItem[] = []; const messages = [...messageIds];
    // Four concurrent metadata reads, no attachments or whole mailbox download.
    for (let i = 0; i < messages.length; i += 4) {
      const batch = await Promise.allSettled(messages.slice(i, i + 4).map(async id => {
        const fields = new URLSearchParams({ format: 'metadata', fields: 'id,threadId,snippet,internalDate,payload(headers)' });
        for (const header of ['Subject', 'From', 'To', 'Cc']) fields.append('metadataHeaders', header);
        const value = await googleJson<{ id: string; threadId: string; snippet?: string; internalDate: string; payload?: { headers?: { name: string; value: string }[] } }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?${fields}`, { headers });
        return { id: value.id, title: clip(value.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value, 300) || '（件名なし）',
          sourceName: clip(value.payload?.headers?.find(h => h.name.toLowerCase() === 'from')?.value, 300), text: clip(unescape(value.snippet), 1000),
          conversationId: value.threadId, recipients: clip(value.payload?.headers?.filter(h => ['to', 'cc'].includes(h.name.toLowerCase())).map(h => h.value).join(' ／ '), 1000),
          at: new Date(Number(value.internalDate)).toISOString(), url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(connection.email)}#all/${encodeURIComponent(value.threadId)}` };
      }));
      for (const result of batch) { if (result.status === 'fulfilled') items.push(result.value); else partial = true; }
    }
    if (messages.length && !items.length) throw new GoogleWorkspaceError('GOOGLE_UNAVAILABLE', 'メールを取得できませんでした。前回の情報を保持しています。');
    return { items: items.sort((a, b) => b.at.localeCompare(a.at)), partial };
  }
  const items: GoogleItem[] = []; let partial = false; let succeeded = 0;
  for (const space of selected) {
    try {
      const params = new URLSearchParams({ pageSize: '20', orderBy: 'createTime DESC', filter: `createTime > "${new Date(now.getTime() - 7 * 86400000).toISOString()}"`, fields: 'messages(name,text,createTime,sender(displayName)),nextPageToken' });
      const data = await googleJson<{ messages?: { name: string; text?: string; createTime: string; sender?: { displayName?: string } }[]; nextPageToken?: string }>(`https://chat.googleapis.com/v1/${space.id}/messages?${params}`, { headers });
      succeeded++;
      if (data.nextPageToken) partial = true;
      for (const message of data.messages ?? []) {
        if (!message.createTime || !Number.isFinite(Date.parse(message.createTime))) { partial = true; continue; }
        const body = clip(message.text, 2000);
        if (!message.text || message.text.length > 2000) partial = true;
        items.push({ id: message.name, title: clip(message.sender?.displayName, 200) || '投稿', text: body || '本文以外の投稿です。Google Chatで確認してください。', at: message.createTime,
          url: `https://chat.google.com/room/${encodeURIComponent(space.id.slice(7))}?authuser=${encodeURIComponent(connection.email)}`, sourceName: space.name });
      }
    } catch { partial = true; }
  }
  if (connection.selectedSpaces.length && !succeeded) throw new GoogleWorkspaceError('GOOGLE_UNAVAILABLE', 'Chatを取得できませんでした。権限・API設定を確認してください。前回の情報を保持しています。');
  return { items: items.sort((a, b) => b.at.localeCompare(a.at)), partial };
}
export async function readGoogleChoices(service: GoogleService, token: string): Promise<{ choices: GoogleSelection[]; partial: boolean }> {
  const headers = { Authorization: `Bearer ${token}` };
  if (service === 'calendar') {
    const params = new URLSearchParams({ maxResults: '100', minAccessRole: 'reader', showHidden: 'true', fields: 'items(id,summary,summaryOverride,primary),nextPageToken' });
    const data = await googleJson<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[]; nextPageToken?: string }>(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`, { headers });
    return { choices: (data.items ?? []).slice(0, 100).map(c => ({ id: c.primary ? 'primary' : c.id, name: `${c.summaryOverride || c.summary || c.id}${c.primary ? '（メイン）' : ''}` })), partial: !!data.nextPageToken || (data.items?.length ?? 0) > 100 };
  }
  if (service === 'gmail') {
    const data = await googleJson<{ labels?: { id: string; name: string }[] }>('https://gmail.googleapis.com/gmail/v1/users/me/labels?fields=labels(id,name)', { headers });
    return { choices: (data.labels ?? []).slice(0, 200), partial: (data.labels?.length ?? 0) > 200 };
  }
  const params = new URLSearchParams({ pageSize: '100', filter: 'spaceType = "SPACE" OR spaceType = "GROUP_CHAT"', fields: 'spaces(name,displayName),nextPageToken' });
  const data = await googleJson<{ spaces?: { name: string; displayName?: string }[]; nextPageToken?: string }>(`https://chat.googleapis.com/v1/spaces?${params}`, { headers });
  return { choices: (data.spaces ?? []).map(s => ({ id: s.name, name: s.displayName || s.name })), partial: !!data.nextPageToken };
}
