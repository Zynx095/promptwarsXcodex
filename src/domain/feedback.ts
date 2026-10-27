// Feedback aggregation with small-group suppression, so averages cannot single out a person.
import type { FeedbackSummary } from '../shared/types';

/** Minimum responses in a category before an average rating is shown. */
export const MIN_GROUP_SIZE = 3;

export function summarizeFeedback(
  records: { category: string; rating: number | null }[],
  categories: { key: string; label: string }[],
  minGroupSize = MIN_GROUP_SIZE,
): FeedbackSummary[] {
  return categories.map(({ key, label }) => {
    const inCat = records.filter((r) => r.category === key);
    const ratings = inCat.map((r) => r.rating).filter((r): r is number => r != null);
    const suppressed = ratings.length < minGroupSize;
    const avg = suppressed ? null : Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10;
    return { category: key, label, count: inCat.length, averageRating: avg, suppressed };
  });
}
