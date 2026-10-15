'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import type { PdfThumbnailSource } from '@/lib/pdf/attachmentSource';
import { loadPdfThumbnail } from '@/lib/pdf/thumbnailClient';

const icon = <FileText className="h-5 w-5" aria-hidden="true" />;
type Props = { name: string; url: string; size: number; source: PdfThumbnailSource; fallback?: ReactNode };

function Thumbnail({ name, url, source, uid, fallback = icon }: Props & { uid: string }) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      let active = true;
      void Promise.resolve().then(() => { if (active) setVisible(true); });
      return () => { active = false; };
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const query = useQuery({
    queryKey: ['pdf-thumbnail', uid, sourceKey, url],
    queryFn: ({ signal }) => loadPdfThumbnail(uid, source, signal),
    enabled: visible,
    retry: false,
    staleTime: 60_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const blob = query.data;
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    let active = true;
    void Promise.resolve().then(() => { if (active) setImage({ blob, url: objectUrl }); });
    return () => { active = false; URL.revokeObjectURL(objectUrl); };
  }, [query.data]);
  const src = !query.isError && !failed && image?.blob === query.data ? image?.url : undefined;
  return <span ref={container} className="relative flex h-full w-full items-center justify-center">
    {src ? <Image src={src} alt={`${name}の1ページ目`} fill sizes="200px" unoptimized
      className="object-contain" onError={() => setFailed(true)} /> : fallback}
  </span>;
}

export function PdfThumbnail(props: Props) {
  const uid = useAuthStore(state => state.firebaseUser?.uid);
  if (!uid || props.size > 10 * 1024 * 1024) return props.fallback ?? icon;
  // Remount immediately when identity/file changes; never render the old image
  // for one frame while the previous query/effect is being cleaned up.
  return <Thumbnail key={`${uid}:${JSON.stringify(props.source)}:${props.url}`} {...props} uid={uid} />;
}
