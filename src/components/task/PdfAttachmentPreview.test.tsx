import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PdfAttachmentPreview } from './PdfAttachmentPreview';

const url = 'https://firebasestorage.googleapis.com/v0/b/demo/o/sample.pdf?alt=media&token=fictitious';
const fetchPdf = vi.fn<typeof fetch>();
const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:pdf-preview');
const revokeObjectURL = vi.fn();
const pdfResponse = (header = '%PDF-1.7\nfixture', type = 'application/pdf') => new Response(header, { headers: { 'Content-Type': type } });
const preview = (source = url) => <PdfAttachmentPreview url={source} name="資料.pdf" className="pdf-frame" />;

beforeEach(() => {
  vi.resetAllMocks();
  createObjectURL.mockReturnValue('blob:pdf-preview');
  fetchPdf.mockImplementation(async () => pdfResponse());
  vi.stubGlobal('fetch', fetchPdf);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('shows loading, checks PDF bytes, normalizes MIME, and releases the object URL on close', async () => {
  let resolve!: (response: Response) => void;
  fetchPdf.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { unmount } = render(preview());
  expect(screen.getByRole('status')).toHaveTextContent('PDFを読み込んでいます');
  expect(screen.queryByTitle('資料.pdf')).not.toBeInTheDocument();
  await waitFor(() => expect(fetchPdf).toHaveBeenCalledTimes(1));
  await act(async () => resolve(pdfResponse('\n%PDF-1.7\nfixture', 'application/octet-stream')));
  expect(await screen.findByTitle('資料.pdf')).toHaveAttribute('src', 'blob:pdf-preview');
  expect(createObjectURL.mock.calls[0][0].type).toBe('application/pdf');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText(/新しいタブで開く/)).toBeVisible();
  expect(fetchPdf).toHaveBeenCalledWith(url, expect.objectContaining({ cache: 'no-store', credentials: 'omit', signal: expect.any(AbortSignal) }));
  const signal = fetchPdf.mock.calls[0][1]!.signal!;
  unmount();
  expect(signal.aborted).toBe(true);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:pdf-preview');
});

it('offers a readable fallback without downloading when native PDF viewing is explicitly disabled', async () => {
  vi.stubGlobal('navigator', { pdfViewerEnabled: false });
  render(preview());
  expect(await screen.findByRole('alert')).toHaveTextContent('このブラウザではPDFのプレビューを表示できません');
  expect(fetchPdf).not.toHaveBeenCalled();
  expect(screen.queryByTitle('資料.pdf')).not.toBeInTheDocument();
});

it.each([403, 404, 500])('reports HTTP %s and succeeds on retry of the unchanged download URL', async status => {
  fetchPdf.mockResolvedValueOnce(new Response('failed', { status }));
  render(preview());
  expect(await screen.findByRole('alert')).toHaveTextContent('PDFを読み込めませんでした');
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByTitle('資料.pdf')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '再取得' }));
  expect(await screen.findByTitle('資料.pdf')).toHaveAttribute('src', 'blob:pdf-preview');
  expect(fetchPdf.mock.calls.map(([source]) => source)).toEqual([url, url]);
});

it.each(['<html>error</html>', '', '{"error":"missing"}'])('refuses a non-PDF response before framing it', async bytes => {
  fetchPdf.mockResolvedValueOnce(pdfResponse(bytes));
  render(preview());
  expect(await screen.findByRole('alert')).toHaveTextContent('PDFとして表示できませんでした');
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByTitle('資料.pdf')).not.toBeInTheDocument();
});

it('preserves native URL embedding when fetch is unavailable due to CORS or network and offers retry', async () => {
  fetchPdf.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  render(preview());
  expect(await screen.findByRole('alert')).toHaveTextContent('読み込みを確認できませんでした');
  expect(screen.getByTitle('資料.pdf')).toHaveAttribute('src', url);
  fireEvent.click(screen.getByRole('button', { name: '再取得' }));
  expect(await screen.findByTitle('資料.pdf')).toHaveAttribute('src', 'blob:pdf-preview');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('times out a stalled request, aborts it, and ignores a late successful response', async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  fetchPdf.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(preview());
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByRole('alert')).toHaveTextContent('時間がかかっています');
  expect(fetchPdf.mock.calls[0][1]!.signal!.aborted).toBe(true);
  await act(async () => resolve(pdfResponse()));
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByTitle('資料.pdf')).not.toBeInTheDocument();
  vi.useRealTimers();
  fireEvent.click(screen.getByRole('button', { name: '再取得' }));
  expect(await screen.findByTitle('資料.pdf')).toHaveAttribute('src', 'blob:pdf-preview');
});

it('aborts on unmount without creating a stale preview when download finishes afterwards', async () => {
  let resolve!: (response: Response) => void;
  fetchPdf.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { unmount } = render(preview());
  await waitFor(() => expect(fetchPdf).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => resolve(pdfResponse()));
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(fetchPdf.mock.calls[0][1]!.signal!.aborted).toBe(true);
});

it('does not start a download if the preview closes before the loading effect proceeds', async () => {
  const { unmount } = render(preview());
  unmount();
  await act(async () => Promise.resolve());
  expect(fetchPdf).not.toHaveBeenCalled();
});

it('releases successful previews on retry and URL changes, and only shows the current file', async () => {
  const { rerender } = render(<StrictMode>{preview()}</StrictMode>);
  await screen.findByTitle('資料.pdf');
  fireEvent.click(screen.getByRole('button', { name: '再取得' }));
  await screen.findByTitle('資料.pdf');
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  rerender(<StrictMode>{preview('/changed.pdf')}</StrictMode>);
  await screen.findByTitle('資料.pdf');
  expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(fetchPdf).toHaveBeenLastCalledWith('/changed.pdf', expect.any(Object));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});
