// Compute quality + cost metrics from routing outcomes.
//
// Savings is an ESTIMATE based on relative token-cost weights (heavy = 1.0).
// The table is versioned and dated so a drifted estimate is visible in
// report output ("price table v2, 2026-09-11") instead of silently wrong;
// override it per-machine with `priceTable` in ~/.smart-dispatch/config.json.
// v2 re-keys the table to canonical slots; legacy-vocabulary outcomes
// (haiku/sonnet/opus, pre-v0.5.0 logs) are canonicalized on the way in.
import { canonicalSlot } from './model-registry.js'

export const PRICE_TABLE = Object.freeze({
  version: 2,
  asOf: '2026-09-11',
  relative: Object.freeze({ light: 0.1, mid: 0.3, heavy: 1.0 }),
})

/**
 * @param {Array<{trueTier:'Trivial'|'Routine'|'Hard', chosenModel:'light'|'mid'|'heavy'}>} outcomes
 *   legacy slot aliases are accepted and canonicalized internally
 * @param {{relativeCost?: Object<string, number>}} [options]
 * @returns {{falseDowngradeRate:number|null, savingsRate:number|null, count:number}}
 */
export function computeMetrics(outcomes, { relativeCost = PRICE_TABLE.relative } = {}) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return { falseDowngradeRate: null, savingsRate: null, count: 0 }
  }

  // False downgrade: a Hard task routed below heavy (quality loss).
  // This is the RED-LINE metric — target ~0.
  const hardTasks = outcomes.filter((o) => o.trueTier === 'Hard')
  const falseDowngrades = hardTasks.filter((o) => canonicalSlot(o.chosenModel) !== 'heavy')
  const falseDowngradeRate = hardTasks.length > 0
    ? falseDowngrades.length / hardTasks.length
    : 0

  // Savings: actual cost vs all-heavy baseline.
  const actualCost = outcomes.reduce(
    (sum, o) => sum + (relativeCost[canonicalSlot(o.chosenModel)] ?? 1.0),
    0
  )
  const baselineCost = outcomes.length * (relativeCost.heavy ?? 1.0)
  // Round to 10 dp to absorb float artifacts (e.g. 1 - 1.1/2 = 0.4499...96 → 0.45),
  // so the metric compares cleanly without changing its meaning.
  const savingsRate = baselineCost > 0
    ? Math.round((1 - actualCost / baselineCost) * 1e10) / 1e10
    : 0

  return { falseDowngradeRate, savingsRate, count: outcomes.length }
}
