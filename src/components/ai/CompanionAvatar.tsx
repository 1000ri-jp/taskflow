import Image from 'next/image';
import { cn } from '@/lib/utils';
import styles from './CompanionAvatar.module.css';

export function CompanionAvatar({ className, label }: { className?: string; label?: string }) {
  const artworkStyle = {
    width: '142.857%',
    height: '142.857%',
    left: '-21.429%',
    top: '-17.143%',
  };
  return <span className={cn(styles.avatar, 'h-8 w-8', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <Image src="/companions/moai/moai-white.png" alt="" width={1500} height={1500} sizes="240px" draggable={false} className={styles.image} style={artworkStyle} />
  </span>;
}
