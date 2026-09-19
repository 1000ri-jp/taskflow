import { CompanionAvatar } from './CompanionAvatar';
import styles from './CompanionLauncher.module.css';

export function CompanionMascot({ busy = false, unread = false }: { busy?: boolean; unread?: boolean }) {
  return <span aria-hidden="true" className={styles.mascot} data-busy={busy} data-unread={unread}>
    <span className={styles.halo} />
    <span className={styles.shadow} />
    <span className={styles.body}>
      <CompanionAvatar className="h-16 w-16" />
    </span>
  </span>;
}
