import { describe, expect, it } from 'vitest';
import { dailyTopics, getDailyTopic } from './daily-topic';

describe('getDailyTopic', () => {
  it('同じ日には同じ豆トピックを返す', () => {
    const date = new Date(2026, 8, 2);

    expect(getDailyTopic(date)).toBe(getDailyTopic(new Date(2026, 8, 2)));
  });

  it('日付が変わると次の豆トピックへ進む', () => {
    const today = getDailyTopic(new Date(2026, 8, 2));
    const tomorrow = getDailyTopic(new Date(2026, 8, 3));

    expect(dailyTopics).toContain(today);
    expect(dailyTopics).toContain(tomorrow);
    expect(tomorrow).not.toBe(today);
  });
});
