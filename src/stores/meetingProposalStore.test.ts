import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEETING_ID } from '@/lib/dashboard/meeting-proposals';
import { MEETING_REVIEW_STORAGE_KEY, parseMeetingReviews, useMeetingProposalStore, validProposalEdits } from './meetingProposalStore';

const edits = { title: '画像を制作', owner: '', dueDate: '', content: '内容を確認する' };
describe('browser-only meeting review store', () => {
  beforeEach(() => { localStorage.removeItem(MEETING_REVIEW_STORAGE_KEY); useMeetingProposalStore.setState({ reviews: {}, persistenceFailed: false }); });
  afterEach(() => vi.restoreAllMocks());
  it('persists one review per stable proposal ID and restores it', () => {
    const state = useMeetingProposalStore.getState();
    state.review('EX-3', 'adopted'); state.review('EX-3', 'adopted');
    expect(Object.keys(JSON.parse(localStorage.getItem(MEETING_REVIEW_STORAGE_KEY)!).reviews)).toEqual(['EX-3']);
    useMeetingProposalStore.setState({ reviews: {} }); state.hydrate();
    expect(useMeetingProposalStore.getState().reviews['EX-3'].status).toBe('adopted');
  });
  it('edits reset adoption to pending; returning to pending retains edits and reset restores seed', () => {
    const state = useMeetingProposalStore.getState();
    state.review('EX-3', 'adopted'); expect(state.edit('EX-3', edits)).toBe(true);
    expect(useMeetingProposalStore.getState().reviews['EX-3']).toEqual({ status: 'pending', edits });
    state.review('EX-3', 'held'); state.review('EX-3', 'pending');
    expect(useMeetingProposalStore.getState().reviews['EX-3'].edits).toEqual(edits);
    state.reset('EX-3'); expect(useMeetingProposalStore.getState().reviews['EX-3']).toBeUndefined();
  });
  it('ignores malformed, wrong-version or unknown records and invalid dates', () => {
    expect(parseMeetingReviews('{broken')).toEqual({});
    expect(parseMeetingReviews(JSON.stringify({ meetingId: 'old', reviews: { 'EX-3': { status: 'adopted' } } }))).toEqual({});
    expect(parseMeetingReviews(JSON.stringify({ meetingId: MEETING_ID, reviews: { unknown: { status: 'adopted' }, 'EX-1': { status: 'nope' }, 'EX-3': { status: 'pending', edits: { ...edits, dueDate: '2026-02-31' } } } }))).toEqual({});
    expect(validProposalEdits({ ...edits, dueDate: '2026-09-13' })).toBe(true);
    expect(useMeetingProposalStore.getState().edit('unknown', edits)).toBe(false);
    expect(useMeetingProposalStore.getState().edit('EX-3', { ...edits, title: ' ' })).toBe(false);
  });
  it('retains session changes and reports storage failures instead of claiming saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    useMeetingProposalStore.getState().review('EX-1', 'adopted');
    expect(useMeetingProposalStore.getState()).toMatchObject({ persistenceFailed: true, reviews: { 'EX-1': { status: 'adopted' } } });
  });
  it('preserves unrelated browser settings and other proposals', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    useMeetingProposalStore.getState().review('EX-1', 'held');
    useMeetingProposalStore.getState().edit('EX-3', edits);
    useMeetingProposalStore.getState().reset('EX-3');
    expect(useMeetingProposalStore.getState().reviews).toEqual({ 'EX-1': { status: 'held' } });
    expect(write.mock.calls.every(([key]) => key === MEETING_REVIEW_STORAGE_KEY)).toBe(true);
  });
  it('does not overwrite or migrate v1 reviews into the replacement memo', () => {
    const legacy = JSON.stringify({ meetingId: '2026-09-03-v1', reviews: { 'A-2': { status: 'adopted' } } });
    localStorage.setItem('taskflow.meetingProposalReview.v1', legacy);
    useMeetingProposalStore.getState().hydrate();
    expect(useMeetingProposalStore.getState().reviews).toEqual({});
    useMeetingProposalStore.getState().review('EX-3', 'adopted');
    expect(localStorage.getItem('taskflow.meetingProposalReview.v1')).toBe(legacy);
    localStorage.removeItem('taskflow.meetingProposalReview.v1');
  });
  it('preserves edits and multiple assignees across correspondence changes and reload', () => {
    const state = useMeetingProposalStore.getState();
    state.edit('EX-9', { ...edits, owner: 'Naofumi・こずえ・Kaori', assigneeIds: ['nao','ko','ka','ko'] });
    state.review('EX-9', 'adopted');
    state.setTarget('EX-9', { mode:'existing', projectId:'p', taskId:'t' });
    expect(useMeetingProposalStore.getState().reviews['EX-9'].status).toBe('pending');
    state.hydrate();
    expect(useMeetingProposalStore.getState().reviews['EX-9']).toMatchObject({ target:{mode:'existing',projectId:'p',taskId:'t'}, edits:{assigneeIds:['nao','ko','ka']} });
    state.setTarget('EX-9', {mode:'new'});
    state.edit('EX-9', edits);
    expect(useMeetingProposalStore.getState().reviews['EX-9'].target).toEqual({mode:'new'});
    state.setTarget('EX-9');
    state.hydrate();
    expect(useMeetingProposalStore.getState().reviews['EX-9'].target).toBeUndefined();
  });
  it('loads older v2 records and rejects malformed correspondence and member IDs', () => {
    const raw = (review: unknown) => JSON.stringify({meetingId:MEETING_ID,reviews:{'EX-1':review}});
    expect(parseMeetingReviews(raw({status:'held'}))).toEqual({'EX-1':{status:'held'}});
    expect(parseMeetingReviews(raw({status:'pending',target:{mode:'existing',projectId:'p',taskId:'../secret'}}))).toEqual({});
    expect(validProposalEdits({...edits,assigneeIds:['bad/id']})).toBe(false);
  });
  it('cannot adopt a future idea or save likely credentials', () => {
    useMeetingProposalStore.getState().review('TF-7', 'adopted');
    expect(useMeetingProposalStore.getState().reviews).toEqual({});
    expect(useMeetingProposalStore.getState().edit('EX-3', { ...edits, content: 'password: test-only-value' })).toBe(false);
    expect(localStorage.getItem(MEETING_REVIEW_STORAGE_KEY)).toBeNull();
  });
});
