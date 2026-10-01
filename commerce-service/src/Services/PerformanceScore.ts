import { IMetric, IPerformanceInputs, RATING_MAX } from "../Models/Hr/Performance.Interface.js";
import { divideHalfUp } from "../Utils/PeopleInput.js";

// The score is a weighted share of how much of each target a person met, capped at 100%
// per measure. Everything is integer arithmetic (shares in permille) so the same inputs
// always give the same score. Targets are company defaults, not per-role settings.
export const TARGET_ATTENDANCE_PCT = 95;
export const TARGET_PUNCTUALITY_PCT = 90;
export const TARGET_TRAINING_PCT = 100;
export const TARGET_RATING = 4;

const WEIGHTS = { attendance_rate: 3, punctuality: 2, training_completion: 2, appraisal_rating: 3 } as const;
const TREND_BAND_PCT = 2;

type MetricKey = keyof typeof WEIGHTS;

export interface Measure {
  key: MetricKey;
  name: string;
  target: number;
  /** Shown value: a percentage with one decimal, or the rating. */
  actual: number;
  /** Share of the target met, 0 to 1000 permille. */
  attainmentPermille: number;
}

// Share of `n` out of `d` as a percentage with one decimal, capped at 100.
const percentTenths = (n: number, d: number) => Math.min(1000, divideHalfUp(n * 1000, d));

const percentMeasure = (key: MetricKey, name: string, target: number, n: number, d: number): Measure => ({
  key,
  name,
  target,
  actual: percentTenths(n, d) / 10,
  attainmentPermille: Math.min(1000, divideHalfUp(n * 100_000, d * target)),
});

/** The measures that apply to this person and period: one with nothing to measure is left out. */
export const measuresOf = (input: IPerformanceInputs): Measure[] => {
  const measures: Measure[] = [];
  const attended = input.present + input.late;
  if (input.expectedDays > 0) {
    measures.push(percentMeasure("attendance_rate", "Attendance rate (%)", TARGET_ATTENDANCE_PCT, attended, input.expectedDays));
  }
  if (attended > 0) {
    measures.push(percentMeasure("punctuality", "Punctuality (%)", TARGET_PUNCTUALITY_PCT, input.present, attended));
  }
  if (input.trainingDue > 0) {
    measures.push(percentMeasure("training_completion", "Training completed (%)", TARGET_TRAINING_PCT, input.trainingDone, input.trainingDue));
  }
  if (input.ratings.length > 0) {
    const rating = Math.min(RATING_MAX, input.ratings[0]);
    measures.push({
      key: "appraisal_rating",
      name: "Appraisal rating (1-5)",
      target: TARGET_RATING,
      actual: rating,
      attainmentPermille: Math.min(1000, divideHalfUp(rating * 1000, TARGET_RATING)),
    });
  }
  return measures;
};

/** 0 to 100 with one decimal (half up), or null when nothing could be measured. */
export const scoreOf = (measures: Measure[]): number | null => {
  if (measures.length === 0) return null;
  const weight = measures.reduce((sum, m) => sum + WEIGHTS[m.key], 0);
  const weighted = measures.reduce((sum, m) => sum + WEIGHTS[m.key] * m.attainmentPermille, 0);
  return divideHalfUp(weighted, weight) / 10;
};

/** Up or down when a measure moved by more than 2% of its target since the earlier period. */
export const trendOf = (actual: number, previous: number | undefined, target: number): IMetric["trend"] => {
  if (previous === undefined) return "flat";
  const band = (target * TREND_BAND_PCT) / 100;
  if (actual - previous > band) return "up";
  if (previous - actual > band) return "down";
  return "flat";
};

export const toMetrics = (current: Measure[], previous: Measure[]): IMetric[] => {
  const before = new Map(previous.map((m) => [m.key, m.actual]));
  return current.map((m) => ({ name: m.name, target: m.target, actual: m.actual, trend: trendOf(m.actual, before.get(m.key), m.target) }));
};
