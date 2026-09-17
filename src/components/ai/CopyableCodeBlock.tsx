'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './ChatMessage.module.css';

export function CopyableCodeBlock({children}: {children: ReactNode}) {
  const pre = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (status !== 'copied') return;
    const timer = window.setTimeout(() => setStatus('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  async function copy() {
    const text = pre.current?.textContent;
    if (text == null || busy) return;
    setBusy(true); setStatus('idle');
    try { await navigator.clipboard.writeText(text); setStatus('copied'); }
    catch { setStatus('error'); }
    finally { setBusy(false); }
  }
  return <div className={styles.codeBlock}>
    <div className={styles.codeToolbar}>
      {status === 'error' && <span role="alert" className="text-xs text-amber-800">コピーできませんでした。もう一度お試しください。</span>}
      <Button type="button" size="icon" className="size-7" variant="ghost" aria-label="コードをコピー" title={status === 'copied' ? 'コピーしました' : 'コードをコピー'} disabled={busy} onClick={() => void copy()}>
        {status === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}<span className="sr-only" aria-live="polite">{status === 'copied' ? 'コピーしました' : 'コピー'}</span>
      </Button>
    </div>
    <pre ref={pre}>{children}</pre>
  </div>;
}
