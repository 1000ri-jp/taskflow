import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMeetLinks, LEGACY_MEET_LINK_STORAGE_KEY, MEET_LINK_STORAGE_KEY, normalizeMeetUrl, useMeetLinkStore } from './meetLinkStore';

const url = 'https://meet.google.com/abc-defg-hij';
const secondUrl = 'https://meet.google.com/lookup/team';
describe('meetLinkStore', () => {
  beforeEach(() => {
    localStorage.removeItem(MEET_LINK_STORAGE_KEY);
    localStorage.removeItem(LEGACY_MEET_LINK_STORAGE_KEY);
    useMeetLinkStore.setState({ links: emptyMeetLinks(), persistenceFailed: false });
  });
  afterEach(() => vi.restoreAllMocks());
  it('saves and restores two named shortcuts independently', () => {
    expect(useMeetLinkStore.getState().links).toEqual(emptyMeetLinks());
    expect(useMeetLinkStore.getState().save(0, ' 朝会 ', ` ${url} `)).toBe(true);
    expect(useMeetLinkStore.getState().save(1, '打ち合わせ', secondUrl)).toBe(true);
    useMeetLinkStore.setState({ links: emptyMeetLinks() });
    useMeetLinkStore.getState().hydrate();
    expect(useMeetLinkStore.getState().links).toEqual([{ name: '朝会', url }, { name: '打ち合わせ', url: secondUrl }]);
    useMeetLinkStore.getState().save(0, '夕会', secondUrl);
    expect(useMeetLinkStore.getState().links[1]).toEqual({ name: '打ち合わせ', url: secondUrl });
    useMeetLinkStore.getState().clear(0);
    useMeetLinkStore.getState().hydrate();
    expect(useMeetLinkStore.getState().links).toEqual([{ name: '夕会', url: null }, { name: '打ち合わせ', url: secondUrl }]);
  });
  it('inherits the old single link without altering it, and does not resurrect a removed link', () => {
    localStorage.setItem(LEGACY_MEET_LINK_STORAGE_KEY, JSON.stringify(url));
    useMeetLinkStore.getState().hydrate();
    expect(useMeetLinkStore.getState().links).toEqual([{ name: 'Google Meet', url }, { name: 'Meet 2', url: null }]);
    expect(localStorage.getItem(MEET_LINK_STORAGE_KEY)).toBeNull();
    useMeetLinkStore.getState().clear(0);
    useMeetLinkStore.getState().hydrate();
    expect(useMeetLinkStore.getState().links[0].url).toBeNull();
    expect(JSON.parse(localStorage.getItem(LEGACY_MEET_LINK_STORAGE_KEY)!)).toBe(url);
  });
  it.each(['javascript:alert(1)', 'http://meet.google.com/abc', 'https://meet.google.com.evil.test/abc', 'https://evil.test/abc', 'https://person@meet.google.com/abc', 'https://meet.google.com:8443/abc', 'https://meet.google.com/', 'not a url'])('rejects unsafe or non-meeting URLs: %s', (invalid) => {
    useMeetLinkStore.getState().save(0, '朝会', url);
    const saved = localStorage.getItem(MEET_LINK_STORAGE_KEY);
    expect(normalizeMeetUrl(invalid)).toBeNull();
    expect(useMeetLinkStore.getState().save(0, '変更', invalid)).toBe(false);
    expect(useMeetLinkStore.getState().links[0]).toEqual({ name: '朝会', url });
    expect(localStorage.getItem(MEET_LINK_STORAGE_KEY)).toBe(saved);
  });
  it.each([' ', 'a'.repeat(41)])('requires a name of 1–40 characters', (name) => {
    expect(useMeetLinkStore.getState().save(1, name, url)).toBe(false);
    expect(useMeetLinkStore.getState().links).toEqual(emptyMeetLinks());
    expect(localStorage.getItem(MEET_LINK_STORAGE_KEY)).toBeNull();
  });
  it('accepts a Meet lookup link and ignores corrupt saved values', () => {
    expect(normalizeMeetUrl('https://meet.google.com/lookup/team')).toBe('https://meet.google.com/lookup/team');
    for (const saved of ['broken', '[]', JSON.stringify('javascript:alert(1)')]) {
      localStorage.setItem(MEET_LINK_STORAGE_KEY, saved);
      useMeetLinkStore.getState().hydrate();
      expect(useMeetLinkStore.getState().links).toEqual(emptyMeetLinks());
    }
    localStorage.setItem(MEET_LINK_STORAGE_KEY, JSON.stringify([{ name: ' 朝会 ', url }, { name: 1, url: 'javascript:alert(1)' }]));
    useMeetLinkStore.getState().hydrate();
    expect(useMeetLinkStore.getState().links).toEqual([{ name: '朝会', url }, { name: 'Meet 2', url: null }]);
  });
  it('reports blocked storage but keeps the link usable for the session', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(useMeetLinkStore.getState().save(0, '朝会', url)).toBe(true);
    expect(useMeetLinkStore.getState()).toMatchObject({ links: [{ name: '朝会', url }, { name: 'Meet 2', url: null }], persistenceFailed: true });
  });
});
