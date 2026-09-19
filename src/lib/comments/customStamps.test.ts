// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { MAX_STAMP_IMAGE_BYTES, ReactionError } from './reactions';

const storage = vi.hoisted(() => ({ objects: new Map<string, { metadata: Record<string, unknown>; bytes: Buffer }>(), saves: [] as { path: string; options: Record<string, unknown> }[], loseAck: false, fail: false }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminStorage: () => ({ bucket: (name: string) => ({ name, file: (path: string) => ({
  save: async (bytes: Buffer, options: Record<string, unknown>) => {
    storage.saves.push({ path, options });
    if (storage.fail) throw new Error('storage offline');
    if (storage.objects.has(path)) throw Object.assign(new Error('precondition'), { code: 412 });
    storage.objects.set(path, { metadata: structuredClone(options.metadata as Record<string, unknown>), bytes });
    if (storage.loseAck) { storage.loseAck = false; throw new Error('ack lost'); }
  },
  getMetadata: async () => { const object = storage.objects.get(path); if (!object) throw new Error('missing'); return [object.metadata]; },
}) }) }) }));
vi.mock('./repository', () => ({ checkCustomStampRegistration: vi.fn(), registerCustomStamp: vi.fn() }));
import { checkCustomStampRegistration, registerCustomStamp } from './repository';
import { customStampForm, normalizeStampImage, uploadCustomStamp } from './customStamps';
import { stampImagePath } from './stampImageIdentity';

const id = 'custom_00000000-0000-0000-0000-000000000001' as const;
const png = () => sharp({ create: { width: 8, height: 4, channels: 4, background: '#ff000088' } }).png().toBuffer();
const input = async () => ({ id, name: '私のねこ', bytes: await png(), mimeType: 'image/png' });
const formRequest = (file: Blob, extra?: (form: FormData) => void) => {
  const form = new FormData(); form.set('id', id); form.set('name', '私のねこ'); form.set('file', file, 'stamp.png'); extra?.(form);
  return new Request('http://localhost/api/comment-stamp-settings/custom', { method: 'POST', body: form });
};

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'project.appspot.com');
  storage.objects.clear(); storage.saves = []; storage.loseAck = false; storage.fail = false;
  vi.mocked(checkCustomStampRegistration).mockResolvedValue(null);
  vi.mocked(registerCustomStamp).mockImplementation(async (_uid, stamp) => ({ seenStampId: stamp.id, customStamps: [stamp] }));
});

describe('bounded custom image input', () => {
  it('parses only the three allowed fields and trims the display name', async () => {
    const bytes = await png();
    const parsed = await customStampForm(formRequest(new Blob([new Uint8Array(bytes)], { type: 'image/png' }), form => form.set('name', '  猫  ')));
    expect(parsed).toEqual({ id, name: '猫', mimeType: 'image/png', bytes });
  });
  it.each(['userId', 'imageUrl', 'customStamps'])('rejects a caller-supplied %s', async field => {
    await expect(customStampForm(formRequest(new Blob(['png'], { type: 'image/png' }), form => form.set(field, 'other')))).rejects.toMatchObject({ status: 422 });
  });
  it('rejects duplicated fields, paths, missing names, and more than 40 characters', async () => {
    const file = new Blob(['png'], { type: 'image/png' });
    for (const change of [(f: FormData) => f.append('id', id), (f: FormData) => f.set('id', '../alice'), (f: FormData) => f.set('name', ' '), (f: FormData) => f.set('name', '名'.repeat(41))]) {
      await expect(customStampForm(formRequest(file, change))).rejects.toMatchObject({ status: 422 });
    }
  });
  it('rejects unsupported types, empty input, and files over 2MiB', async () => {
    for (const file of [new Blob(['svg'], { type: 'image/svg+xml' }), new Blob([], { type: 'image/png' }), new Blob([new Uint8Array(MAX_STAMP_IMAGE_BYTES + 1)], { type: 'image/png' })]) {
      await expect(customStampForm(formRequest(file))).rejects.toThrow('2MB');
    }
  });
  it('bounds streamed input even when the Content-Length claims one byte', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(128 * 1024)); }, cancel() { cancelled = true; } });
    const request = new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': '1' }, body, duplex: 'half' } as RequestInit);
    await expect(customStampForm(request)).rejects.toThrow('2MB');
    expect(cancelled).toBe(true);
  });
  it.each(['image/png', 'image/jpeg', 'image/webp'])('decodes %s and emits a static PNG within 512px without source metadata', async mimeType => {
    const source = sharp({ create: { width: 800, height: 400, channels: 4, background: '#aa8800' } }).withMetadata({ exif: { IFD0: { Artist: 'private author' } } });
    const format = mimeType.slice(6) as 'png' | 'jpeg' | 'webp';
    const bytes = await source.toFormat(format).toBuffer();
    const normalized = await normalizeStampImage(bytes, mimeType);
    const metadata = await sharp(normalized).metadata();
    expect(metadata).toEqual(expect.objectContaining({ format: 'png', width: 512, height: 256 }));
    expect(metadata.exif).toBeUndefined();
    expect(metadata.pages ?? 1).toBe(1);
  });
  it('rejects MIME spoofing, malformed/truncated files, and excessive decoded pixel count', async () => {
    await expect(normalizeStampImage(await png(), 'image/jpeg')).rejects.toThrow('静止画像');
    await expect(normalizeStampImage(Buffer.from('<svg/>'), 'image/png')).rejects.toThrow('静止画像');
    await expect(normalizeStampImage((await png()).subarray(0, 45), 'image/png')).rejects.toThrow('静止画像');
    const huge = await sharp({ create: { width: 4097, height: 4097, channels: 3, background: 'white' } }).png().toBuffer();
    expect(huge.length).toBeLessThan(MAX_STAMP_IMAGE_BYTES);
    await expect(normalizeStampImage(huge, 'image/png')).rejects.toThrow('静止画像');
  });
  it('rejects animated WebP and APNG instead of silently adopting just the first frame', async () => {
    const animated = await sharp(Buffer.alloc(2 * 4 * 4).fill(255, 0, 16), { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } }).webp({ delay: [100, 100], loop: 0 }).toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    await expect(normalizeStampImage(animated, 'image/webp')).rejects.toThrow('静止画像');
    const original = await png();
    const chunk = Buffer.from([0, 0, 0, 8, 97, 99, 84, 76, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(normalizeStampImage(Buffer.concat([original.subarray(0, 33), chunk, original.subarray(33)]), 'image/png')).rejects.toThrow('静止画像');
  });
});

describe('immutable image registration', () => {
  it('uploads only normalized bytes to the authenticated owner path with create-only precondition', async () => {
    const result = await uploadCustomStamp('alice', await input());
    expect(storage.saves).toHaveLength(1);
    expect(storage.saves[0]).toEqual(expect.objectContaining({ path: stampImagePath('alice', id), options: expect.objectContaining({ preconditionOpts: { ifGenerationMatch: 0 }, resumable: false }) }));
    expect(result.seenStampId).toBe(id);
    expect(result.customStamps?.[0].imageUrl).toContain('comment-stamps%2Falice%2F');
    expect(registerCustomStamp).toHaveBeenCalledWith('alice', expect.objectContaining({ id, name: '私のねこ' }), expect.stringMatching(/^[a-f0-9]{64}$/));
  });
  it('recovers a lost upload acknowledgement using the same immutable object/token', async () => {
    storage.loseAck = true;
    const first = await uploadCustomStamp('alice', await input());
    const second = await uploadCustomStamp('alice', await input());
    expect(second).toEqual(first);
    expect(storage.objects.size).toBe(1);
    expect(storage.saves).toHaveLength(2);
  });
  it('preserves the saved image after a failed catalog commit and completes the identical retry', async () => {
    vi.mocked(registerCustomStamp).mockRejectedValueOnce(new Error('database offline'));
    await expect(uploadCustomStamp('alice', await input())).rejects.toThrow('database offline');
    const saved = structuredClone(storage.objects.get(stampImagePath('alice', id))?.metadata);
    await uploadCustomStamp('alice', await input());
    expect(storage.objects.get(stampImagePath('alice', id))?.metadata).toEqual(saved);
  });
  it('rejects a different image/name reusing the same upload id without replacing storage', async () => {
    await uploadCustomStamp('alice', await input());
    const saved = structuredClone(storage.objects.get(stampImagePath('alice', id))?.metadata);
    await expect(uploadCustomStamp('alice', { ...await input(), name: '別の名前' })).rejects.toMatchObject({ status: 409 });
    expect(storage.objects.get(stampImagePath('alice', id))?.metadata).toEqual(saved);
    expect(registerCustomStamp).toHaveBeenCalledTimes(1);
  });
  it('returns an already registered retry and rejects full catalogs before touching storage', async () => {
    vi.mocked(checkCustomStampRegistration).mockResolvedValueOnce({ seenStampId: 'flower' });
    expect(await uploadCustomStamp('alice', await input())).toEqual({ seenStampId: 'flower' });
    vi.mocked(checkCustomStampRegistration).mockRejectedValueOnce(new ReactionError('20点まで'));
    await expect(uploadCustomStamp('alice', await input())).rejects.toThrow('20点');
    expect(storage.saves).toEqual([]); expect(registerCustomStamp).not.toHaveBeenCalled();
  });
  it('does not register an image on upload failure, missing configuration, or invalid bytes', async () => {
    storage.fail = true;
    await expect(uploadCustomStamp('alice', await input())).rejects.toThrow('storage offline');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', '');
    await expect(uploadCustomStamp('alice', await input())).rejects.toMatchObject({ status: 503 });
    await expect(uploadCustomStamp('alice', { ...await input(), bytes: Buffer.from('not an image') })).rejects.toMatchObject({ status: 422 });
    expect(registerCustomStamp).not.toHaveBeenCalled();
  });
});
