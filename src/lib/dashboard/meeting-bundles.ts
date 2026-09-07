// Presentation-only grouping: stable child IDs, owners and dependencies stay intact.
export const MEETING_BUNDLES = [
  { id: 'ex-submit', parentId: 'EX', title: '出展情報の準備・提出', children: ['EX-1', 'EX-2', 'EX-3', 'EX-4', 'EX-5', 'EX-6', 'EX-7'] },
  { id: 'ex-attend', parentId: 'EX', title: '参加登録・チケット購入', children: ['EX-8', 'EX-9'] },
  { id: 'ex-pack', parentId: 'EX', title: '梱包・持ち物・運搬の準備', children: ['EX-10', 'EX-11', 'EX-12'] },
  { id: 'ex-publicity', parentId: 'EX', title: '展示会の出展告知', children: ['EX-13'] },
  { id: 'ex-progress', parentId: 'EX', title: '関連制作・印刷の進捗確認', children: ['EX-14'] },
  { id: 'mo-recruit', parentId: 'MO', title: 'モニター募集の条件・告知準備', children: ['MO-date', 'MO-1', 'MO-2', 'MO-3'] },
  { id: 'mo-reading', parentId: 'MO', title: '鑑定書の基本版・詳細版を整える', children: ['MO-5', 'MO-6', 'MO-7'] },
  { id: 'mo-feedback', parentId: 'MO', title: 'モニター実施・アンケート・レビュー回収', children: ['MO-4', 'MO-8'] },
  { id: 'st-design', parentId: 'ST', title: '天然石商品の試作・仕様・価格設計', children: ['ST-1', 'ST-2', 'ST-3', 'ST-4'] },
  { id: 'st-sales', parentId: 'ST', title: 'セット提供・販売条件・配送を整える', children: ['ST-5', 'ST-6', 'ST-7'] },
  { id: 'tf-display', parentId: 'TF', title: 'タスク表示の設計・実装・動作確認', children: ['TF-1', 'TF-3', 'TF-4'] },
  { id: 'tf-db', parentId: 'TF', title: 'データベース変更案のレビュー', children: ['TF-5'] },
  { id: 'tf-google', parentId: 'TF', title: 'Google連携の前提確認', children: ['TF-6'] },
];
