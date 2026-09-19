export const UPCOMING_RANGES = [5, 7] as const;
export type UpcomingRange = typeof UPCOMING_RANGES[number];
export const DEFAULT_UPCOMING_DAYS: UpcomingRange = 5;
export const MAX_UPCOMING_DAYS: UpcomingRange = 7;
