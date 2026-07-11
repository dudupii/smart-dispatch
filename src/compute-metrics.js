// Compute quality + cost metrics from routing outcomes.
// Relative token-cost weights (opus = 1.0). Approximate but consistent.
const RELATIVE_COST = { haiku: 0.1, sonnet: 0.3, opus: 1.0 }

/**
 * @param {Array<{trueTier:'Trivial'|'Routine'|'Hard', chosenModel:'haiku'|'sonnet'|'opus'}>} outcomes
 * @returns {{falseDowngradeRate:number|null, savingsRate:number|null, count:number}}
 */
export function computeMetrics(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return { falseDowngradeRate: null, savingsRate: null, count: 0 }
  }

  // False downgrade: a Hard task routed below opus (quality loss).
  // This is the RED-LINE metric — target ~0.
  const hardTasks = outcomes.filter((o) => o.trueTier === 'Hard')
  const falseDowngrades = hardTasks.filter((o) => o.chosenModel !== 'opus')
  const falseDowngradeRate = hardTasks.length > 0
    ? falseDowngrades.length / hardTasks.length
    : 0

  // Savings: actual cost vs all-opus baseline.
  const actualCost = outcomes.reduce(
    (sum, o) => sum + (RELATIVE_COST[o.chosenModel] ?? 1.0),
    0
  )
  const baselineCost = outcomes.length * RELATIVE_COST.opus
  // Round to 10 dp to absorb float artifacts (e.g. 1 - 1.1/2 = 0.4499...96 → 0.45),
  // so the metric compares cleanly without changing its meaning.
  const savingsRate = baselineCost > 0
    ? Math.round((1 - actualCost / baselineCost) * 1e10) / 1e10
    : 0

  return { falseDowngradeRate, savingsRate, count: outcomes.length }
}
