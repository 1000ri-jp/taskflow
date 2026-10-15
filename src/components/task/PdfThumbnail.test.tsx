import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { loadPdfThumbnail } from '@/lib/pdf/thumbnailClient';
import { PdfThumbnail } from './PdfThumbnail';

vi.mock('@/lib/pdf/thumbnailClient', () => ({ loadPdfThumbnail: vi.fn() }));
vi.mock('next/image', () => ({ default: ({ src, alt, onError }: { src: string; alt: string; onError: () => void }) =>
  // Exercise the browser image error event without Next's image loader.
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt={alt} data-src={src} onError={onError} /> }));
const source = { projectId: 'p', kind: 'comment', taskId: 't', commentId: 'c', attachmentId: 'a' } as const;
const create = vi.fn(() => 'blob:thumbnail');
const revoke = vi.fn();
let clients: QueryClient[];
beforeEach(() => {
  vi.resetAllMocks();
  clients = [];
  create.mockReturnValue('blob:thumbnail');
  vi.mocked(loadPdfThumbnail).mockResolvedValue(new Blob(['image'], { type: 'image/webp' }));
  useAuthStore.setState({ firebaseUser: { uid: 'alice' } as User });
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); useAuthStore.getState().reset(); vi.unstubAllGlobals(); });
function preview() {
  return <PdfThumbnail name="図面.pdf" url="https://example.test/file.pdf" size={1000} source={source} />;
}
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

it('waits until visible, shares a rendered image across duplicate cards, and releases each image URL', async () => {
  let intersect!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe = vi.fn(); disconnect = disconnect;
  });
  const { rerender, unmount } = render(preview(), { wrapper: wrapper() });
  expect(loadPdfThumbnail).not.toHaveBeenCalled();
  await act(async () => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(await screen.findByRole('img', { name: '図面.pdfの1ページ目' })).toHaveAttribute('data-src', 'blob:thumbnail');
  rerender(<>{preview()}{preview()}</>);
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
  expect(loadPdfThumbnail).toHaveBeenCalledTimes(1);
  unmount();
  expect(revoke).toHaveBeenCalledTimes(create.mock.calls.length);
  expect(disconnect).toHaveBeenCalled();
});

it('falls back quietly for unavailable PDFs and keeps no error banner', async () => {
  vi.mocked(loadPdfThumbnail).mockRejectedValue(new Error('unavailable'));
  render(preview(), { wrapper: wrapper() });
  await waitFor(() => expect(loadPdfThumbnail).toHaveBeenCalledTimes(1));
  await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});

it('clears a previous account image immediately and cancels pending work on close', async () => {
  const { unmount } = render(preview(), { wrapper: wrapper() });
  await screen.findByRole('img');
  let signal: AbortSignal | undefined;
  vi.mocked(loadPdfThumbnail).mockImplementationOnce(async (_uid, _source, currentSignal) => {
    signal = currentSignal;
    return new Promise<Blob>(() => {});
  });
  act(() => useAuthStore.setState({ firebaseUser: { uid: 'bob' } as User }));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(revoke).toHaveBeenCalledWith('blob:thumbnail');
  await waitFor(() => expect(signal).toBeDefined());
  unmount();
  expect(signal!.aborted).toBe(true);
});

it('does not download while signed out or for an oversized PDF', async () => {
  useAuthStore.setState({ firebaseUser: null });
  const { rerender } = render(preview(), { wrapper: wrapper() });
  expect(loadPdfThumbnail).not.toHaveBeenCalled();
  act(() => useAuthStore.setState({ firebaseUser: { uid: 'alice' } as User }));
  rerender(<PdfThumbnail name="large.pdf" url="https://example.test/large.pdf" size={11 * 1024 * 1024} source={source} />);
  await act(async () => Promise.resolve());
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(loadPdfThumbnail).not.toHaveBeenCalled();
});

it('keeps an image decoding failure local to its thumbnail', async () => {
  render(preview(), { wrapper: wrapper() });
  fireEvent.error(await screen.findByRole('img'));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
