import { describe, expect, it } from 'vitest';
import catalog from './project-emojis.generated.json';
import { filterProjectEmojis, loadProjectEmojis, PROJECT_EMOJI_CATEGORIES, PROJECT_EMOJI_QUICK_CHOICES } from './project-emojis';

describe('complete project emoji catalog', () => {
  it('contains the full Emoji 17.0 set, including joined, flag and skin-tone sequences', async () => {
    const emojis = await loadProjectEmojis();
    expect(catalog.unicodeVersion).toBe('17.0');
    expect(emojis).toHaveLength(3944);
    expect(emojis.slice(0, PROJECT_EMOJI_QUICK_CHOICES.length).map(item => item.emoji))
      .toEqual(PROJECT_EMOJI_QUICK_CHOICES.map(item => item.emoji));
    const choices = new Set(emojis.map(item => item.emoji));
    expect(choices.size).toBe(3944);
    for (const emoji of ['🇯🇵', '🏴‍☠️', '👨‍👩‍👧‍👦', '🧑🏽‍🚒', '❤️‍🔥', '🧑‍🩰', ...PROJECT_EMOJI_QUICK_CHOICES.map(item => item.emoji)]) {
      expect(choices.has(emoji), emoji).toBe(true);
    }
    expect(new Set(emojis.map(item => item.category))).toEqual(new Set(PROJECT_EMOJI_CATEGORIES.map(item => item.id)));
    expect(emojis.every(item => item.name && item.keywords)).toBe(true);
  });

  it('finds emojis by Japanese readings, keywords, English and pasted compound emojis', () => {
    const find = (query: string) => filterProjectEmojis(catalog.emojis, query, 'all').map(item => item.emoji);
    expect(find('ねこ')).toContain('🐈‍⬛');
    expect(find('ねこ')).toEqual(find('ネコ'));
    expect(find('猫')).toContain('🐈');
    expect(find('消防士 中間')).toContain('🧑🏽‍🚒');
    expect(find('JAPAN')).toContain('🇯🇵');
    expect(find('👨‍👩‍👧‍👦')).toEqual(['👨‍👩‍👧‍👦']);
    expect(filterProjectEmojis(catalog.emojis, '猫', 'flags')).toEqual([]);
    expect(filterProjectEmojis(catalog.emojis, '', 'flags').every(item => item.category === 'flags')).toBe(true);
  });
});
