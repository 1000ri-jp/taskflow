import Image from 'next/image';
import { cn } from '@/lib/utils';
import styles from './CompanionAvatar.module.css';

// The source artwork is 1500px square with a 1050px display crop. Keep these
// resolved percentages inline so browsers do not leave the image at its
// intrinsic size when they reject percentage multiplication in calc().
const artworkStyle = {
  width: '142.857%',
  height: '142.857%',
  left: '-21.429%',
  top: '-17.143%',
};

export function CompanionAvatar({ className, label }: { className?: string; label?: string }) {
  return <span className={cn(styles.avatar, 'h-8 w-8', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <Image src="/companions/moai/moai-white.png" alt="" width={1500} height={1500} sizes="240px" draggable={false} className={styles.image} style={artworkStyle} />
  </span>;
}
