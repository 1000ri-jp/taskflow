export interface GuideSpecimenReadiness {
  status?: string;
  adoption?: { status?: string; summary: string };
  implementation?: { status?: string; summary: string };
}

export function guideSpecimenStatusLabel(entry?: GuideSpecimenReadiness, forceTrial = false) {
  if (forceTrial || entry?.status === 'trial') {
    return entry?.adoption?.status === 'limited' ? 'ガイド内の試作・一部採用あり' : 'ガイド内の試作・未採用';
  }
  if (entry?.status === 'reference') return '既存表示の参考見本';
  return '現行の採用済み基準';
}

export function guideSpecimenStatusMessage(entry?: GuideSpecimenReadiness) {
  if (entry?.status === 'reference') return '架空データで既存ビューを確認します。新基準の採用や実画面の検証完了ではありません。';
  const adoption = (entry?.adoption?.summary ?? 'なし').replace(/[。．.]+$/u, '');
  const implementation = (entry?.implementation?.summary ?? 'なし').replace(/[。．.]+$/u, '');
  return `複合見本全体はガイド内の試作です。採用済み範囲：${adoption}。実画面への反映：${implementation}。操作結果はこの見本内だけです。`;
}

export function GuideSpecimenStatusSummary({ entry }: { entry: GuideSpecimenReadiness }) {
  if (entry.status !== 'trial') return null;
  return <div className="mt-2 space-y-1 text-sm" aria-label="見本・採用・実画面の状態">
    <p><span className="font-medium">複合見本全体：</span>ガイド内の試作</p>
    <p><span className="font-medium">ユーザー採用：</span>{entry.adoption?.summary ?? 'なし'}</p>
    <p><span className="font-medium">実画面への反映：</span>{entry.implementation?.summary ?? 'なし'}</p>
  </div>;
}
