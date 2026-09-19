'use client';
import { useState } from 'react';
import Image from 'next/image';
import { isCustomSeenStamp, SEEN_STAMPS, type CustomSeenStamp } from '@/lib/comments/reactions';

export function StampPicture({ stampId, customStamp, large = false }: { stampId: string; customStamp?: Pick<CustomSeenStamp, 'name' | 'imageUrl'>; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const size = large ? 48 : 32;
  if (isCustomSeenStamp(stampId)) {
    const url = customStamp?.imageUrl;
    return <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded align-middle" style={{ width: size, height: size }}>
      {url && failedUrl !== url ? <Image src={url} alt="" width={size} height={size} unoptimized draggable={false} className="h-full w-full object-contain" onError={() => setFailedUrl(url)} /> : <span className="text-xl text-muted-foreground">?</span>}
    </span>;
  }
  if (stampId === 'meruru') return <span aria-hidden="true" className="inline-block shrink-0 overflow-hidden align-middle" style={{ width: size, height: size }}>
    <Image src="/companions/meruru/spritesheet.webp" alt="" width={size * 8} height={size * 11 * 208 / 192} sizes={`${size * 8}px`} draggable={false} style={{ width: size * 8, height: size * 11 * 208 / 192, maxWidth: 'none' }} />
  </span>;
  const emoji = stampId === 'thanks' ? '🙏' : stampId === 'celebrate' ? '🎉' : SEEN_STAMPS.find(stamp => stamp.id === stampId)?.emoji ?? '👋';
  return <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size, fontSize: large ? 30 : 25 }}>{emoji}</span>;
}
