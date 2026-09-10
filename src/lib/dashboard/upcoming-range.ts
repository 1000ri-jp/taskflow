export const UPCOMING_RANGES = [3, 5] as const;
export type UpcomingRange = typeof UPCOMING_RANGES[number];
export const MAX_UPCOMING_DAYS: UpcomingRange = 5;
