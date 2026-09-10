export const dailyTopics = [
  'タコの心臓は3つ。2つはえらへ、1つは全身へ血液を送ります。',
  'ハチドリは、空中で後ろ向きに飛べる唯一の鳥です。',
  'バナナは植物学ではベリーの仲間。イチゴはベリーではありません。',
  'ポモドーロ・テクニックの名前は、トマト型のキッチンタイマーが由来です。',
  'サメの祖先は、最初の木が現れるより前から地球の海にいました。',
  'カラスは人の顔を見分け、長いあいだ覚えていられます。',
  'ウォンバットのふんは、転がりにくい立方体の形をしています。',
] as const;

export function getDailyTopic(date: Date): string {
  const dateKey = date.getFullYear() * 372 + date.getMonth() * 31 + date.getDate();
  return dailyTopics[dateKey % dailyTopics.length];
}
