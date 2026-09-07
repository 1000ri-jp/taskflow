import type { MeetingProposal } from './meeting-proposals';

// Curated from the replacement user attachment; no runtime AI or inferred dates.
export const MEETING_PARENTS = [
  {
    "id": "EX",
    "title": "展示会準備",
    "projects": [
      "展示会出展"
    ]
  },
  {
    "id": "MO",
    "title": "個人鑑定モニター募集",
    "projects": [
      "ウリャマ"
    ]
  },
  {
    "id": "ST",
    "title": "天然石商品の試作・販売検討",
    "projects": [
      "Luna*Lis",
      "ウリャマ"
    ]
  },
  {
    "id": "TF",
    "title": "TaskFlowのタスク表示改善",
    "projects": [
      "タスク管理ツール"
    ]
  }
];
export const MEETING_PROPOSALS: MeetingProposal[] = [
  {
    "id": "EX-1",
    "parentId": "EX",
    "sourceId": "親1-1",
    "sourceRefs": [
      "親1-1"
    ],
    "title": "出展情報の正式な締切とイベント名を確認する",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "展示会名は「東京ゲームダンジョン」の可能性が高いが正式名称を確認する。出展情報の正式な締切と提出後の修正可否を確認する。「13日まで」「14日朝9時」は、日付と公式期限を確認するまで確定日として扱わない。",
    "completion": "正式イベント名、提出期限、提出後の修正可否を確認する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "要確認",
    "kind": "action",
    "sourceExcerpt": "1. 出展情報の正式な締切とイベント名を確認する\n- 担当：未指定\n- 優先度：P1\n- ステータス：要確認\n- 完了条件：正式イベント名、提出期限、提出後の修正可否を確認する",
    "questions": [
      "正式な展示会名、公式締切、提出後の修正可否。",
      "「13日まで」「14日朝9時」の日付と関係。"
    ],
    "cautions": [],
    "aliases": [],
    "reason": "提出準備の前提となるイベント名と期限を先に確認"
  },
  {
    "id": "EX-2",
    "parentId": "EX",
    "sourceId": "親1-2",
    "sourceRefs": [
      "親1-2"
    ],
    "title": "出展情報フォームに必要な項目を整理する",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "作品名、団体名、出展者、ジャンル、ゲームエンジン、Xアカウント、ホームページURL、動画URL、作品紹介、運営上の注意事項を整理する\n現時点の候補：作品名「星の繋がり」、ジャンル「パズル」、ゲームエンジン「Unity」、XはNaofumiのアカウント",
    "completion": "フォーム入力項目の一覧が完成する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "2. 出展情報フォームに必要な項目を整理する\n- 担当：未指定\n- 優先度：P1\n- 内容：作品名、団体名、出展者、ジャンル、ゲームエンジン、Xアカウント、ホームページURL、動画URL、作品紹介、運営上の注意事項を整理する\n- 現時点の候補：作品名「星の繋がり」、ジャンル「パズル」、ゲームエンジン「Unity」、XはNaofumiのアカウント\n- 完了条件：フォーム入力項目の一覧が完成する",
    "questions": [],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-3",
    "parentId": "EX",
    "sourceId": "親1-3",
    "sourceRefs": [
      "親1-3"
    ],
    "title": "500×500pxのキービジュアルを制作する",
    "projects": [
      "展示会出展"
    ],
    "owner": "こずえ",
    "dueDate": "",
    "timing": "出展情報提出前",
    "content": "空中に浮かぶ星をつないで星座を作る作品。ホログラムのように浮いて見える表現。AI使用可",
    "completion": "500×500pxの提出用画像が完成する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "3. 500×500pxのキービジュアルを制作する\n- 担当：こずえ\n- 優先度：P1\n- 期限：出展情報提出前\n- 内容：空中に浮かぶ星をつないで星座を作る作品。ホログラムのように浮いて見える表現。AI使用可\n- 完了条件：500×500pxの提出用画像が完成する",
    "questions": [
      "500×500キービジュアルの最終仕様と制作期限。"
    ],
    "cautions": [],
    "aliases": [
      "キービジュアル"
    ],
    "reason": "提出に必要な画像。日付は推定せず「提出前」を保持"
  },
  {
    "id": "EX-4",
    "parentId": "EX",
    "sourceId": "親1-4",
    "sourceRefs": [
      "親1-4"
    ],
    "title": "出展情報用の作品紹介文を作成する",
    "projects": [
      "展示会出展"
    ],
    "owner": "Naofumi Higashikawauchi",
    "dueDate": "",
    "timing": "",
    "content": "空中ディスプレイ、空間コンピューティング、指で星をなぞって星座を作る体験、VRヘッドセット不要、複数人で体験可能であることを含める\n注意：30文字以内・100文字以内の両方が話されているため、フォームの文字数制限を確認する",
    "completion": "各入力欄の文字数制限内の文章が完成する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "4. 出展情報用の作品紹介文を作成する\n- 担当：Naofumi Higashikawauchi\n- 優先度：P1\n- 内容：空中ディスプレイ、空間コンピューティング、指で星をなぞって星座を作る体験、VRヘッドセット不要、複数人で体験可能であることを含める\n- 注意：30文字以内・100文字以内の両方が話されているため、フォームの文字数制限を確認する\n- 完了条件：各入力欄の文字数制限内の文章が完成する",
    "questions": [
      "各入力欄の正式な文字数制限。"
    ],
    "cautions": [],
    "aliases": [
      "作品紹介文"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-5",
    "parentId": "EX",
    "sourceId": "親1-5",
    "sourceRefs": [
      "親1-5"
    ],
    "title": "「星の繋がり」の紹介ページを作成し、URLを確定する",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "「星の繋がり」の紹介ページを作成し、URLを確定する",
    "completion": "公開または提出可能な紹介ページURLがある",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "5. 「星の繋がり」の紹介ページを作成し、URLを確定する\n- 担当：未指定\n- 優先度：P1\n- 完了条件：公開または提出可能な紹介ページURLがある",
    "questions": [
      "ホームページ担当者。"
    ],
    "cautions": [],
    "aliases": [
      "紹介ページ"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-6",
    "parentId": "EX",
    "sourceId": "親1-6",
    "sourceRefs": [
      "親1-6"
    ],
    "title": "展示用動画を準備し、動画URLを確定する",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "展示用動画を準備し、動画URLを確定する",
    "completion": "提出フォームに入力できる動画URLがある",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未着手",
    "kind": "action",
    "sourceExcerpt": "6. 展示用動画を準備し、動画URLを確定する\n- 担当：未指定\n- 優先度：P1\n- ステータス：未着手\n- 完了条件：提出フォームに入力できる動画URLがある",
    "questions": [
      "動画担当者。"
    ],
    "cautions": [],
    "aliases": [
      "紹介動画",
      "展示用動画"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-7",
    "parentId": "EX",
    "sourceId": "親1-7",
    "sourceRefs": [
      "親1-7"
    ],
    "title": "出展情報を一度提出し、提出内容を確認する",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "出展情報を一度提出し、提出内容を確認する",
    "completion": "提出完了を確認し、後から修正可能かを記録する",
    "dependencies": [
      "EX-2",
      "EX-3",
      "EX-4",
      "EX-5",
      "EX-6"
    ],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "7. 出展情報を一度提出し、提出内容を確認する\n- 担当：未指定\n- 優先度：P1\n- 依存：2〜6\n- 完了条件：提出完了を確認し、後から修正可能かを記録する",
    "questions": [
      "親1-1で正式イベント名・公式締切を確認する。"
    ],
    "cautions": [
      "新版では紹介ページ・動画URLの確定も提出の依存項目。旧版の「動画URLは空欄で提出可」は引き継がない。"
    ],
    "aliases": [
      "出展情報提出",
      "出展情報の提出"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-8",
    "parentId": "EX",
    "sourceId": "親1-8",
    "sourceRefs": [
      "親1-8"
    ],
    "title": "展示会への登録者・出展者3名の担当を整理する",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "登録システム上、1つのメールアドレスで複数人を登録できない可能性があるため、登録者と各自の担当を決める",
    "completion": "3名の担当と登録方法が確定する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "8. 展示会への登録者・出展者3名の担当を整理する\n- 担当：未指定\n- 優先度：P1\n- 内容：登録システム上、1つのメールアドレスで複数人を登録できない可能性があるため、登録者と各自の担当を決める\n- 完了条件：3名の担当と登録方法が確定する",
    "questions": [
      "対象イベント、登録者・各自の担当、登録方法。"
    ],
    "cautions": [
      "旧版の東京ゲームショウという名称や個人別割当を確定情報として補わない。"
    ],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-9",
    "parentId": "EX",
    "sourceId": "親1-9",
    "sourceRefs": [
      "親1-9"
    ],
    "title": "展示会チケットを各自購入する",
    "projects": [
      "展示会出展"
    ],
    "owner": "各自",
    "dueDate": "",
    "timing": "",
    "content": "展示会チケットを各自購入する",
    "completion": "必要人数分のチケット購入が完了する",
    "dependencies": [],
    "dependencyConditions": "展示会登録完了・購入案内メール受領",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "9. 展示会チケットを各自購入する\n- 担当：各自\n- 優先度：P1\n- 依存：展示会登録完了・購入案内メール受領\n- 完了条件：必要人数分のチケット購入が完了する",
    "questions": [
      "正式な対象イベントと購入担当者。"
    ],
    "cautions": [
      "購入操作は行わない。登録完了と購入案内メールの受領が前提。"
    ],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-10",
    "parentId": "EX",
    "sourceId": "親1-10",
    "sourceRefs": [
      "親1-10"
    ],
    "title": "梱包資材の注文・到着状況を確認する",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "ダンボール、ウレタンまたはフォーム系緩衝材、その他必要資材を確認する\n注意：一部は注文済みの可能性がある",
    "completion": "注文済み・未注文・到着予定が一覧化される",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "10. 梱包資材の注文・到着状況を確認する\n- 担当：未指定\n- 優先度：P1\n- 内容：ダンボール、ウレタンまたはフォーム系緩衝材、その他必要資材を確認する\n- 注意：一部は注文済みの可能性がある\n- 完了条件：注文済み・未注文・到着予定が一覧化される",
    "questions": [
      "資材の正式名称・注文状況・到着日。"
    ],
    "cautions": [],
    "aliases": [
      "梱包資材"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-11",
    "parentId": "EX",
    "sourceId": "親1-11",
    "sourceRefs": [
      "親1-11"
    ],
    "title": "展示物と備品の持ち物チェックリストを作る",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "展示物、電源ケーブル、工具、ボンド、梱包材などを含める",
    "completion": "全品目を確認できるチェックリストが完成する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "11. 展示物と備品の持ち物チェックリストを作る\n- 担当：未指定\n- 優先度：P1\n- 内容：展示物、電源ケーブル、工具、ボンド、梱包材などを含める\n- 完了条件：全品目を確認できるチェックリストが完成する",
    "questions": [],
    "cautions": [],
    "aliases": [
      "チェックリストの作成",
      "持ち物チェックリスト"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-12",
    "parentId": "EX",
    "sourceId": "親1-12",
    "sourceRefs": [
      "親1-12"
    ],
    "title": "資材到着後に3名で梱包・運搬確認を行う",
    "projects": [
      "展示会出展"
    ],
    "owner": "3名",
    "dueDate": "",
    "timing": "資材到着後",
    "content": "箱詰め、ウレタンまたはフォームの切断・成形、運搬可能かの確認を行う\n役割：2名が作業、1名が不足品や全体を確認",
    "completion": "運搬可能な状態になり、チェックリストが完了する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "12. 資材到着後に3名で梱包・運搬確認を行う\n- 担当：3名\n- 優先度：P1\n- 期限：資材到着後\n- 内容：箱詰め、ウレタンまたはフォームの切断・成形、運搬可能かの確認を行う\n- 役割：2名が作業、1名が不足品や全体を確認\n- 完了条件：運搬可能な状態になり、チェックリストが完了する",
    "questions": [
      "到着日と作業日程・3名の役割。"
    ],
    "cautions": [],
    "aliases": [
      "梱包工作"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-13",
    "parentId": "EX",
    "sourceId": "親1-13",
    "sourceRefs": [
      "親1-13"
    ],
    "title": "Xで展示会出展告知を行う",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "出展告知を投稿し、他の出展者や関連投稿とも交流する",
    "completion": "告知投稿が公開される",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P2",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "13. Xで展示会出展告知を行う\n- 担当：未指定\n- 優先度：P2\n- 内容：出展告知を投稿し、他の出展者や関連投稿とも交流する\n- 完了条件：告知投稿が公開される",
    "questions": [],
    "cautions": [],
    "aliases": [
      "出展告知"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "EX-14",
    "parentId": "EX",
    "sourceId": "親1-14",
    "sourceRefs": [
      "親1-14"
    ],
    "title": "生成AI関連チェックとパンフレット印刷の進捗を確認する",
    "projects": [
      "展示会出展"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "生成AI関連チェックとパンフレット印刷の進捗を確認する\n注意：文字起こしでは「生成A」「チェック作成」「パンフレット印刷」の状況が不明瞭",
    "completion": "遅延状況、担当者、完了予定日が確認できる",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P2",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "14. 生成AI関連チェックとパンフレット印刷の進捗を確認する\n- 担当：未指定\n- 優先度：P2\n- 注意：文字起こしでは「生成A」「チェック作成」「パンフレット印刷」の状況が不明瞭\n- 完了条件：遅延状況、担当者、完了予定日が確認できる",
    "questions": [
      "不明瞭なチェック・印刷作業の進捗。"
    ],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "MO-date",
    "parentId": "MO",
    "sourceId": "会議日・親2-2",
    "sourceRefs": [
      "会議日",
      "親2-2",
      "確認待ち"
    ],
    "title": "会議日とモニター募集の実施日を確認する",
    "projects": [
      "ウリャマ"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "「今日21時」は日付未確定",
    "content": "会議日は2026/9/2との記載だが、録音日時は2026/9/3 08:58 JST。「会議当日21時」の実施日を確認する。確認前に日付へ変換しない。",
    "completion": "会議日と「会議当日21時」の実施日・時刻を確認できる",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "未指定",
    "taskStatus": "要確認",
    "kind": "action",
    "sourceExcerpt": "会議日：2026年9月2日。ただし録音日時表示は2026年9月3日08:58 JST。",
    "questions": [
      "会議日とモニター募集の実施日。"
    ],
    "cautions": [],
    "aliases": [],
    "reason": "添付の登録ルールに従い、相対日付の確認を独立したタスクに整理"
  },
  {
    "id": "MO-1",
    "parentId": "MO",
    "sourceId": "親2-1",
    "sourceRefs": [
      "親2-1"
    ],
    "title": "モニター募集の料金体系を確定する",
    "projects": [
      "ウリャマ"
    ],
    "owner": "脊古香織",
    "dueDate": "",
    "timing": "",
    "content": "最初の5名は500円、次の10名は1,500円、その後は通常価格3,000円という案",
    "completion": "人数・料金・通常価格を最終確定する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "暫定決定",
    "kind": "action",
    "sourceExcerpt": "1. モニター募集の料金体系を確定する\n- 担当：脊古香織\n- 優先度：P1\n- 内容：最初の5名は500円、次の10名は1,500円、その後は通常価格3,000円という案\n- ステータス：暫定決定\n- 完了条件：人数・料金・通常価格を最終確定する",
    "questions": [
      "人数・料金・通常価格の最終確定。"
    ],
    "cautions": [],
    "aliases": [
      "モニター募集"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "MO-2",
    "parentId": "MO",
    "sourceId": "親2-2",
    "sourceRefs": [
      "親2-2"
    ],
    "title": "ThreadsとInstagramでモニター募集を開始する",
    "projects": [
      "ウリャマ"
    ],
    "owner": "脊古香織",
    "dueDate": "",
    "timing": "会議当日21時という案。ただし日付要確認",
    "content": "ThreadsとInstagramでモニター募集を開始する",
    "completion": "両SNSに募集告知が公開される",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "2. ThreadsとInstagramでモニター募集を開始する\n- 担当：脊古香織\n- 優先度：P1\n- 期限：会議当日21時という案。ただし日付要確認\n- 完了条件：両SNSに募集告知が公開される",
    "questions": [
      "会議当日21時が指す実施日。"
    ],
    "cautions": [
      "料金・告知など複数の提案が同じ既存タスクに一致しても、別々に上書きしない。"
    ],
    "aliases": [
      "ココナラモニター募集（3名ほど）",
      "モニター募集"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "MO-3",
    "parentId": "MO",
    "sourceId": "親2-3",
    "sourceRefs": [
      "親2-3"
    ],
    "title": "モニター募集文と商品説明を作成する",
    "projects": [
      "ウリャマ"
    ],
    "owner": "脊古香織",
    "dueDate": "",
    "timing": "",
    "content": "先着人数、料金、DMでの連絡方法、モニター条件、感想・レビューへの協力依頼、支払い後に取引開始となることを記載する",
    "completion": "募集文と商品説明が完成する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "3. モニター募集文と商品説明を作成する\n- 担当：脊古香織\n- 優先度：P1\n- 内容：先着人数、料金、DMでの連絡方法、モニター条件、感想・レビューへの協力依頼、支払い後に取引開始となることを記載する\n- 完了条件：募集文と商品説明が完成する",
    "questions": [],
    "cautions": [],
    "aliases": [
      "モニター募集文"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "MO-4",
    "parentId": "MO",
    "sourceId": "親2-4",
    "sourceRefs": [
      "親2-4"
    ],
    "title": "モニター向けアンケートを作成する",
    "projects": [
      "ウリャマ"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "根拠説明の必要性、情報量、価格、詳細版への関心、石付き商品の関心を確認する",
    "completion": "後で集計・比較できる形式のアンケートが完成する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "4. モニター向けアンケートを作成する\n- 担当：未指定\n- 優先度：P1\n- 内容：根拠説明の必要性、情報量、価格、詳細版への関心、石付き商品の関心を確認する\n- 完了条件：後で集計・比較できる形式のアンケートが完成する",
    "questions": [],
    "cautions": [],
    "aliases": [
      "モニターアンケート"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "MO-5",
    "parentId": "MO",
    "sourceId": "親2-5",
    "sourceRefs": [
      "親2-5"
    ],
    "title": "既存サンプルを確認し、鑑定書の基本版を整える",
    "projects": [
      "ウリャマ"
    ],
    "owner": "脊古香織",
    "dueDate": "",
    "timing": "",
    "content": "既存サンプルを確認し、3,000円相当の読みやすさと内容かを見直す",
    "completion": "モニター提供可能な基本版が完成する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "5. 既存サンプルを確認し、鑑定書の基本版を整える\n- 担当：脊古香織\n- 優先度：P1\n- 内容：既存サンプルを確認し、3,000円相当の読みやすさと内容かを見直す\n- 完了条件：モニター提供可能な基本版が完成する",
    "questions": [],
    "cautions": [],
    "aliases": [
      "デモ鑑定書作成（社内メンバー用）"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "MO-6",
    "parentId": "MO",
    "sourceId": "親2-6",
    "sourceRefs": [
      "親2-6"
    ],
    "title": "鑑定書に載せる根拠の範囲を確定する",
    "projects": [
      "ウリャマ"
    ],
    "owner": "脊古香織・こずえ",
    "dueDate": "",
    "timing": "",
    "content": "現在案では太陽・月・ASCなど、使用する天体・要素の範囲を確認する。鑑定書には、今回使用している範囲を明記する",
    "completion": "使用範囲と説明文が確定する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "6. 鑑定書に載せる根拠の範囲を確定する\n- 担当：脊古香織・こずえ\n- 優先度：P1\n- 内容：現在案では太陽・月・ASCなど、使用する天体・要素の範囲を確認する。鑑定書には、今回使用している範囲を明記する\n- 完了条件：使用範囲と説明文が確定する",
    "questions": [
      "使用する天体・要素の正確な範囲。"
    ],
    "cautions": [],
    "aliases": [
      "鑑定書の表記"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "MO-7",
    "parentId": "MO",
    "sourceId": "親2-7",
    "sourceRefs": [
      "親2-7"
    ],
    "title": "根拠説明を通常版に含めるか、オプションにするか決める",
    "projects": [
      "ウリャマ"
    ],
    "owner": "脊古香織・こずえ",
    "dueDate": "",
    "timing": "",
    "content": "通常版を簡潔に保つ案と、根拠・詳細説明を追加料金のオプションにする案を比較する",
    "completion": "通常版と詳細版の差分、価格、提供方法が決まる",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P2",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "7. 根拠説明を通常版に含めるか、オプションにするか決める\n- 担当：脊古香織・こずえ\n- 優先度：P2\n- 内容：通常版を簡潔に保つ案と、根拠・詳細説明を追加料金のオプションにする案を比較する\n- 完了条件：通常版と詳細版の差分、価格、提供方法が決まる",
    "questions": [],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "MO-8",
    "parentId": "MO",
    "sourceId": "親2-8",
    "sourceRefs": [
      "親2-8"
    ],
    "title": "モニターを実施し、感想・レビューを回収する",
    "projects": [
      "ウリャマ"
    ],
    "owner": "脊古香織",
    "dueDate": "",
    "timing": "",
    "content": "モニターを実施し、感想・レビューを回収する",
    "completion": "モニター人数、回答、レビュー、価格への反応が記録される",
    "dependencies": [
      "MO-2",
      "MO-3",
      "MO-4",
      "MO-5"
    ],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "8. モニターを実施し、感想・レビューを回収する\n- 担当：脊古香織\n- 優先度：P1\n- 依存：2〜5\n- 完了条件：モニター人数、回答、レビュー、価格への反応が記録される",
    "questions": [],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "ST-1",
    "parentId": "ST",
    "sourceId": "親3-1",
    "sourceRefs": [
      "親3-1"
    ],
    "title": "鑑定内容に合わせた天然石商品の3パターンを考える",
    "projects": [
      "Luna*Lis",
      "ウリャマ"
    ],
    "owner": "こずえ",
    "dueDate": "",
    "timing": "",
    "content": "鑑定内容や本人の希望に合わせた石の組み合わせを3パターン作る",
    "completion": "各パターンの石・意味・対象価格帯が整理される",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "1. 鑑定内容に合わせた天然石商品の3パターンを考える\n- 担当：こずえ\n- 優先度：P1\n- 内容：鑑定内容や本人の希望に合わせた石の組み合わせを3パターン作る\n- 完了条件：各パターンの石・意味・対象価格帯が整理される",
    "questions": [],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "ST-2",
    "parentId": "ST",
    "sourceId": "親3-2",
    "sourceRefs": [
      "親3-2"
    ],
    "title": "ブレスレットの試作品を作り、仕様を比較する",
    "projects": [
      "Luna*Lis",
      "ウリャマ"
    ],
    "owner": "こずえ",
    "dueDate": "",
    "timing": "",
    "content": "6mmブレスレット、小さめの2連タイプ、天然石とビーズを組み合わせたタイプ、長さ調整可能な仕様を比較する",
    "completion": "試作品、材料費、制作時間、見た目の比較ができる",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P2",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "2. ブレスレットの試作品を作り、仕様を比較する\n- 担当：こずえ\n- 優先度：P2\n- 内容：6mmブレスレット、小さめの2連タイプ、天然石とビーズを組み合わせたタイプ、長さ調整可能な仕様を比較する\n- 完了条件：試作品、材料費、制作時間、見た目の比較ができる",
    "questions": [],
    "cautions": [],
    "aliases": [
      "ブレスレット"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "ST-3",
    "parentId": "ST",
    "sourceId": "親3-3",
    "sourceRefs": [
      "親3-3"
    ],
    "title": "天然石商品の原価と販売価格を試算する",
    "projects": [
      "Luna*Lis",
      "ウリャマ"
    ],
    "owner": "こずえ",
    "dueDate": "",
    "timing": "",
    "content": "入門・標準・上位などのセット、ブレスレット、チャームの価格帯を試算する。天然石のみか、ビーズ併用かで分ける",
    "completion": "原価、制作時間、販売価格、利益の試算表が完成する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "3. 天然石商品の原価と販売価格を試算する\n- 担当：こずえ\n- 優先度：P1\n- 内容：入門・標準・上位などのセット、ブレスレット、チャームの価格帯を試算する。天然石のみか、ビーズ併用かで分ける\n- 完了条件：原価、制作時間、販売価格、利益の試算表が完成する",
    "questions": [
      "天然石商品の価格。"
    ],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "ST-4",
    "parentId": "ST",
    "sourceId": "親3-4",
    "sourceRefs": [
      "親3-4"
    ],
    "title": "オーダー時に確認する情報を決める",
    "projects": [
      "Luna*Lis",
      "ウリャマ"
    ],
    "owner": "こずえ",
    "dueDate": "",
    "timing": "",
    "content": "手首周り、好みのゆるさ、好きな色、避けたい色、必ず入れたい色、デザインの好みを確認する",
    "completion": "注文フォームまたはヒアリング項目が完成する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P2",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "4. オーダー時に確認する情報を決める\n- 担当：こずえ\n- 優先度：P2\n- 内容：手首周り、好みのゆるさ、好きな色、避けたい色、必ず入れたい色、デザインの好みを確認する\n- 完了条件：注文フォームまたはヒアリング項目が完成する",
    "questions": [],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "ST-5",
    "parentId": "ST",
    "sourceId": "親3-5",
    "sourceRefs": [
      "親3-5"
    ],
    "title": "鑑定書と天然石商品のセット提供方法を決める",
    "projects": [
      "Luna*Lis",
      "ウリャマ"
    ],
    "owner": "こずえ・脊古香織",
    "dueDate": "",
    "timing": "",
    "content": "鑑定モニターと並行して石付き商品を試す。モニターへの提供、プレゼント、追加購入の扱いを決める",
    "completion": "提供条件と販売導線が決まる",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P2",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "5. 鑑定書と天然石商品のセット提供方法を決める\n- 担当：こずえ・脊古香織\n- 優先度：P2\n- 内容：鑑定モニターと並行して石付き商品を試す。モニターへの提供、プレゼント、追加購入の扱いを決める\n- 完了条件：提供条件と販売導線が決まる",
    "questions": [],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "ST-6",
    "parentId": "ST",
    "sourceId": "親3-6",
    "sourceRefs": [
      "親3-6"
    ],
    "title": "メルカリ等での販売可否と表現上のリスクを確認する",
    "projects": [
      "Luna*Lis",
      "ウリャマ"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "鑑定書、天然石、パワーストーン、効果の表現、オーダーメイド商品の出品可否を公式ルールと必要な専門確認に基づいて確認する\n注意：確認が終わるまで出品しない",
    "completion": "使用可能な表現、避ける表現、販売者名義、販売先が決まる",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "6. メルカリ等での販売可否と表現上のリスクを確認する\n- 担当：未指定\n- 優先度：P1\n- 内容：鑑定書、天然石、パワーストーン、効果の表現、オーダーメイド商品の出品可否を公式ルールと必要な専門確認に基づいて確認する\n- 完了条件：使用可能な表現、避ける表現、販売者名義、販売先が決まる\n- 注意：確認が終わるまで出品しない",
    "questions": [
      "出品可否・表現ルール・名義・販売先。"
    ],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "ST-7",
    "parentId": "ST",
    "sourceId": "親3-7",
    "sourceRefs": [
      "親3-7"
    ],
    "title": "モニターへのプレゼント配送方法を確認する",
    "projects": [
      "Luna*Lis",
      "ウリャマ"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "LINEギフト、匿名配送など、相手の住所を直接取得せずに送れる方法を確認する",
    "completion": "利用可能な配送方法と費用が決まる",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P2",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "7. モニターへのプレゼント配送方法を確認する\n- 担当：未指定\n- 優先度：P2\n- 内容：LINEギフト、匿名配送など、相手の住所を直接取得せずに送れる方法を確認する\n- 完了条件：利用可能な配送方法と費用が決まる",
    "questions": [],
    "cautions": [],
    "aliases": [
      "匿名配送"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "TF-1",
    "parentId": "TF",
    "sourceId": "親4-1・親4-2",
    "sourceRefs": [
      "親4-1",
      "親4-2"
    ],
    "title": "親・サブタスクの担当に応じた自分のタスク表示を設計する",
    "projects": [
      "タスク管理ツール"
    ],
    "owner": "実装担当",
    "dueDate": "",
    "timing": "",
    "content": "表示単位は親タスクとする。自分が担当するサブタスクがある場合、代表1件を表示し、「他3件」のように残り件数を表示する\n親タスクの担当者が自分でない場合でも、自分が担当するサブタスクがあれば親タスクを表示する。親タスク自体を担当している場合は親タスクを表示する",
    "completion": "同じ親タスクがサブタスク数だけ重複表示されない。担当パターンごとの表示テストが通る",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "1. サブタスクを含めた自分のタスク表示を設計する\n- 担当：実装担当\n- 優先度：P1\n- 内容：表示単位は親タスクとする。自分が担当するサブタスクがある場合、代表1件を表示し、「他3件」のように残り件数を表示する\n- 完了条件：同じ親タスクがサブタスク数だけ重複表示されない\n\n2. 親タスク担当とサブタスク担当を正しく表示する\n- 担当：実装担当\n- 優先度：P1\n- 内容：親タスクの担当者が自分でない場合でも、自分が担当するサブタスクがあれば親タスクを表示する。親タスク自体を担当している場合は親タスクを表示する\n- 完了条件：担当パターンごとの表示テストが通る",
    "questions": [],
    "cautions": [],
    "aliases": [
      "サブタスク表示",
      "今日やるものがわかるように"
    ],
    "reason": "同じ表示設計・担当判定を扱う親4-1と親4-2を統合"
  },
  {
    "id": "TF-3",
    "parentId": "TF",
    "sourceId": "親4-3",
    "sourceRefs": [
      "親4-3"
    ],
    "title": "モックデータを確認し、実データと混ざるものをクローズする",
    "projects": [
      "タスク管理ツール"
    ],
    "owner": "実装担当",
    "dueDate": "",
    "timing": "",
    "content": "モックデータを確認し、実データと混ざるものをクローズする",
    "completion": "ダッシュボード上に不要なモックタスクが残っていない",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "3. モックデータを確認し、実データと混ざるものをクローズする\n- 担当：実装担当\n- 優先度：P1\n- 完了条件：ダッシュボード上に不要なモックタスクが残っていない",
    "questions": [],
    "cautions": [
      "ここでは候補を記録するだけで実データを削除・完了にしない。"
    ],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "TF-4",
    "parentId": "TF",
    "sourceId": "親4-4",
    "sourceRefs": [
      "親4-4"
    ],
    "title": "まずローカルでタスク表示を実装・確認する",
    "projects": [
      "タスク管理ツール"
    ],
    "owner": "実装担当",
    "dueDate": "",
    "timing": "",
    "content": "既存の会社TaskFlowデータを使い、個人画面は表示中心で実装する。既存トップ画面は変更しない",
    "completion": "ローカル環境で親タスク・サブタスク表示が確認できる",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "4. まずローカルでタスク表示を実装・確認する\n- 担当：実装担当\n- 優先度：P1\n- 内容：既存の会社TaskFlowデータを使い、個人画面は表示中心で実装する。既存トップ画面は変更しない\n- 完了条件：ローカル環境で親タスク・サブタスク表示が確認できる",
    "questions": [],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "TF-5",
    "parentId": "TF",
    "sourceId": "親4-5",
    "sourceRefs": [
      "親4-5"
    ],
    "title": "データベース変更案を一覧化し、レビューを受ける",
    "projects": [
      "タスク管理ツール"
    ],
    "owner": "実装担当",
    "dueDate": "",
    "timing": "",
    "content": "追加予定のフィールド、変更箇所、既存データへの影響を一覧化する。削除を伴う変更は避ける",
    "completion": "実装前にデータベース設計のレビューが完了する",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P1",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "5. データベース変更案を一覧化し、レビューを受ける\n- 担当：実装担当\n- 優先度：P1\n- 内容：追加予定のフィールド、変更箇所、既存データへの影響を一覧化する。削除を伴う変更は避ける\n- 完了条件：実装前にデータベース設計のレビューが完了する",
    "questions": [],
    "cautions": [
      "採用はDB変更・PR作成の実行許可ではない。"
    ],
    "aliases": [
      "DB変更",
      "データベースの変更"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "TF-6",
    "parentId": "TF",
    "sourceId": "親4-6",
    "sourceRefs": [
      "親4-6"
    ],
    "title": "Googleカレンダー・メール・チャット連携の前提を確認する",
    "projects": [
      "タスク管理ツール"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "会社アカウントか個人アカウントか、管理者承認、API設定、必要な権限を確認する\n注意：認証情報はTaskFlowやタスク本文に保存しない",
    "completion": "連携対象アカウントと管理者対応が明確になる",
    "dependencies": [],
    "dependencyConditions": "",
    "priority": "P2",
    "taskStatus": "未指定",
    "kind": "action",
    "sourceExcerpt": "6. Googleカレンダー・メール・チャット連携の前提を確認する\n- 担当：未指定\n- 優先度：P2\n- 内容：会社アカウントか個人アカウントか、管理者承認、API設定、必要な権限を確認する\n- 完了条件：連携対象アカウントと管理者対応が明確になる\n- 注意：認証情報はTaskFlowやタスク本文に保存しない",
    "questions": [
      "連携に必要な会社アカウントと管理者。"
    ],
    "cautions": [
      "この試作で認証や権限設定は変更しない。"
    ],
    "aliases": [
      "連携エラー",
      "Googleカレンダー"
    ],
    "reason": "新版の添付メモから整理"
  },
  {
    "id": "TF-7",
    "parentId": "TF",
    "sourceId": "親4-7",
    "sourceRefs": [
      "親4-7"
    ],
    "title": "ウィジェット化・表示カスタマイズを将来候補として整理する",
    "projects": [
      "タスク管理ツール"
    ],
    "owner": "",
    "dueDate": "",
    "timing": "",
    "content": "初心者向け・慣れた人向けの表示切替、ウィジェット化、項目のカスタマイズを整理する\n注意：コアのタスク表示改善が完了するまで実装しない",
    "completion": "未指定（検討候補）",
    "dependencies": [],
    "dependencyConditions": "コアのタスク表示改善が完了するまで実装しない",
    "priority": "P3",
    "taskStatus": "検討候補",
    "kind": "idea",
    "sourceExcerpt": "7. ウィジェット化・表示カスタマイズを将来候補として整理する\n- 担当：未指定\n- 優先度：P3\n- ステータス：検討候補\n- 内容：初心者向け・慣れた人向けの表示切替、ウィジェット化、項目のカスタマイズを整理する\n- 注意：コアのタスク表示改善が完了するまで実装しない",
    "questions": [],
    "cautions": [],
    "aliases": [],
    "reason": "新版の添付メモから整理"
  }
];
export const MEETING_CONFIRMATIONS = [
  "正式な展示会名",
  "出展情報の正式締切",
  "「13日まで」と「14日朝9時」のどちらが正しいか",
  "展示会登録とチケット購入の担当者",
  "500×500キービジュアルの最終仕様",
  "ホームページ担当者と動画担当者",
  "梱包資材の正式名称・注文状況・到着日",
  "モニター募集の実施日",
  "鑑定書で使用する天体・要素の正確な範囲",
  "天然石商品の価格と販売先",
  "メルカリ等の販売ルール・表現ルール",
  "Google連携に必要な会社アカウントと管理者"
];
