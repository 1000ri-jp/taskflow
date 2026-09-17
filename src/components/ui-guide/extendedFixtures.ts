import { guideDescription, guideTitle } from './fixtures';

export function guideNotifications(long: boolean, many: boolean) {
  return Array.from({ length: many ? 12 : 3 }, (_, i) => ({
    id: `guide-notice-${i}`, title: `${i + 1}. ${i === 0 ? '案内の確認をお願いします' : long ? guideTitle(true) : '準備の期限が変わりました'}`,
    message: guideDescription(long), date: `9月16日 ${10 + Math.floor(i / 6)}:${String(i * 5 % 60).padStart(2, '0')}`,
  }));
}

export function guideHistory(long: boolean) {
  return [
    { id: 'purchase', label: '購入報告', description: long ? guideDescription(true) : '案内用の紙を購入した記録です。', deleted: false },
    { id: 'organization', label: '仕事の整理', description: '案内の準備を担当別に整理しました。', deleted: false },
    { id: 'unknown', label: 'その他の更新', description: '項目名が未登録の更新です。表示文言は検討中です。', deleted: false },
    { id: 'deleted', label: 'タスクの更新', description: '以前の案内を更新した記録です。対象は削除済みです。', deleted: true },
  ];
}
