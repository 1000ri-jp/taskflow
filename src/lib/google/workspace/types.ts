export const GOOGLE_SERVICES = ['calendar', 'gmail', 'chat'] as const;
export type GoogleService = typeof GOOGLE_SERVICES[number];
export const MAX_GOOGLE_SELECTIONS = 5;
export const SERVICE_LABELS: Record<GoogleService, string> = { calendar: 'Googleカレンダー', gmail: 'Gmail', chat: 'Google Chat' };
export interface GoogleItem {
  id: string; title: string; text: string; at: string; end?: string; allDay?: boolean; url: string; sourceName: string;
  conversationId?: string; recipients?: string;
  /** Calendar metadata is optional for legacy caches and absent for Gmail/Chat. */
  eventType?: string; workingLocationProperties?: { type?: string };
}
export interface GoogleSource {
  connected: boolean; fetchedAt: string | null; attemptedAt: string | null;
  status: 'disconnected' | 'pending' | 'ready' | 'partial' | 'error' | 'selection_required';
  error: string | null; items: GoogleItem[];
}
export interface GoogleSelection { id: string; name: string }
export interface GoogleWorkspaceView {
  configured: boolean; email: string | null;
  sources: Record<GoogleService, GoogleSource>;
  selectedSpaces: GoogleSelection[]; selectedCalendars: GoogleSelection[]; gmailLabels: GoogleSelection[];
  calendarSelectionAvailable: boolean;
}
export interface StoredGoogleSelections {
  selectedSpaces: GoogleSelection[];
  selectedCalendars?: GoogleSelection[];
  gmailLabels?: GoogleSelection[];
  /** Legacy single-label setting, read until the next settings save. */
  gmailLabel?: GoogleSelection;
}
export function googleSelections(connection: StoredGoogleSelections, service: GoogleService): GoogleSelection[] {
  if (service === 'calendar') return connection.selectedCalendars ?? [{ id: 'primary', name: 'メインカレンダー' }];
  if (service === 'gmail') return connection.gmailLabels ?? [connection.gmailLabel ?? { id: 'INBOX', name: '受信トレイ' }];
  return connection.selectedSpaces;
}
export const emptyGoogleSource = (): GoogleSource => ({ connected: false, fetchedAt: null, attemptedAt: null, status: 'disconnected', error: null, items: [] });
export const emptyGoogleWorkspace = (configured = false): GoogleWorkspaceView => ({ configured, email: null,
  sources: { calendar: emptyGoogleSource(), gmail: emptyGoogleSource(), chat: emptyGoogleSource() },
  selectedSpaces: [], selectedCalendars: [{ id: 'primary', name: 'メインカレンダー' }],
  gmailLabels: [{ id: 'INBOX', name: '受信トレイ' }], calendarSelectionAvailable: false });
