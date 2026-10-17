'use client';

import { useEffect, useState } from 'react';
import { AsyncState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { HelpText } from '@/components/ui/typography';

const LOAD_TIMEOUT_MS = 30_000;
const OPEN_SEPARATELY = '表示されない場合は「新しいタブで開く」からPDFを確認できます。';
class PdfPreviewError extends Error {}
type PreviewState = { src: string; error?: never } | { src?: never; error?: string };

function PdfLoadAttempt({ url, name, className, onRetry }: {
  url: string; name: string; className: string; onRetry: () => void;
}) {
  const [state, setState] = useState<PreviewState>({});
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    let receivedResponse = false;
    const timeout = setTimeout(() => {
      controller.abort();
      setState({ error: 'PDFの読み込みに時間がかかっています。接続を確認して再取得してください。' });
    }, LOAD_TIMEOUT_MS);

    void (async () => {
      try {
        await Promise.resolve();
        if (controller.signal.aborted) return;
        if (navigator.pdfViewerEnabled === false) {
          throw new PdfPreviewError(`このブラウザではPDFのプレビューを表示できません。${OPEN_SEPARATELY}`);
        }
        // iframe load fires even for failed requests. Fetch first so HTTP errors
        // are actionable, and download-only/wrong MIME responses render as PDFs.
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
        if (controller.signal.aborted) return;
        receivedResponse = true;
        if (!response.ok) throw new PdfPreviewError('PDFを読み込めませんでした。ファイルと接続を確認して再取得してください。');
        const blob = await response.blob();
        const header = await blob.slice(0, 1024).text();
        if (!/%PDF-\d\.\d/.test(header)) throw new PdfPreviewError('このファイルをPDFとして表示できませんでした。');
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob.slice(0, blob.size, 'application/pdf'));
        setState({ src: objectUrl });
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (!receivedResponse && cause instanceof TypeError) {
          // Existing download URLs can work in native frames even when their
          // server disallows CORS. An unverified fetch is not a failed preview;
          // keep the native viewer and its normal new-tab/retry controls.
          setState({ src: url });
        } else {
          setState({ error: cause instanceof PdfPreviewError ? cause.message : 'PDFを読み込めませんでした。接続を確認して再取得してください。' });
        }
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      controller.abort();
      clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return <div className="flex h-[min(70vh,calc(90dvh-8rem))] w-full flex-col justify-center">
    {!state.src && !state.error && <AsyncState state="loading" message="PDFを読み込んでいます…" />}
    {state.error && <AsyncState state="error" message={state.error} onRetry={onRetry} />}
    {state.src && <iframe src={state.src} className={className} title={name} />}
    {state.src && !state.error && <>
      <HelpText>{OPEN_SEPARATELY}</HelpText>
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onRetry}>再取得</Button>
    </>}
  </div>;
}

export function PdfAttachmentPreview({ url, name, className }: { url: string; name: string; className: string }) {
  const [attempt, setAttempt] = useState(0);
  return <PdfLoadAttempt key={`${url}:${attempt}`} url={url} name={name} className={className} onRetry={() => setAttempt(value => value + 1)} />;
}
