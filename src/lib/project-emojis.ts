export const DEFAULT_PROJECT_EMOJI = '📁';

export const PROJECT_EMOJI_QUICK_CHOICES = [
  { emoji: '📁', name: 'フォルダー' },
  { emoji: '🦙', name: 'ラマ' },
  { emoji: '🚀', name: 'ロケット' },
  { emoji: '💼', name: '仕事かばん' },
  { emoji: '🎯', name: '的' },
  { emoji: '📊', name: '棒グラフ' },
  { emoji: '🔧', name: 'レンチ' },
  { emoji: '💡', name: '電球' },
  { emoji: '🎨', name: 'パレット' },
  { emoji: '📱', name: '携帯電話' },
  { emoji: '🌐', name: '地球' },
] as const;

export const PROJECT_EMOJI_CATEGORIES = [
  { id: 'smileys', name: '顔・気持ち' },
  { id: 'people', name: '人・体' },
  { id: 'nature', name: '動物・自然' },
  { id: 'food', name: '食べ物・飲み物' },
  { id: 'travel', name: '乗り物・場所' },
  { id: 'activities', name: '活動・スポーツ' },
  { id: 'objects', name: 'もの・道具' },
  { id: 'symbols', name: '記号' },
  { id: 'flags', name: '旗' },
] as const;

export interface ProjectEmoji {
  emoji: string;
  name: string;
  keywords: string;
  category: string;
}

// Keep the familiar project choices at the start of the same full catalog.
export async function loadProjectEmojis(): Promise<ProjectEmoji[]> {
  const emojis = (await import('./project-emojis.generated.json')).default.emojis;
  const preferred = new Set<string>(PROJECT_EMOJI_QUICK_CHOICES.map(item => item.emoji));
  const familiar = PROJECT_EMOJI_QUICK_CHOICES.flatMap(choice => {
    const item = emojis.find(item => item.emoji === choice.emoji);
    return item ? [{ ...item, name: choice.name, keywords: `${item.keywords} ${item.name}` }] : [];
  });
  return [...familiar, ...emojis.filter(item => !preferred.has(item.emoji))];
}

export function normalizeEmojiSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/\ufe0f/g, '')
    .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

export function filterProjectEmojis(emojis: ProjectEmoji[], query: string, category: string): ProjectEmoji[] {
  const words = normalizeEmojiSearch(query).trim().split(/\s+/).filter(Boolean);
  return emojis.filter(item => {
    if (category !== 'all' && item.category !== category) return false;
    if (!words.length) return true;
    const text = normalizeEmojiSearch(`${item.emoji} ${item.name} ${item.keywords}`);
    return words.every(word => text.includes(word));
  });
}
