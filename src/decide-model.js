// Quality-first model selection policy.
// This is the SINGLE SOURCE OF TRUTH for routing decisions.
// skills/smart-dispatch/SKILL.md mirrors these rules — keep them in sync.

const DOWNGRADE_THRESHOLD = 0.8 // confidence required to leave opus
const BUDGET_FLOOR = 0.1        // below this remaining-budget fraction, opus may step down

const TIER_MODEL = {
  Trivial: 'haiku',
  Routine: 'sonnet',
  Hard: 'opus',
  Unknown: 'opus',
}

/**
 * @param {object} input
 * @param {'Trivial'|'Routine'|'Hard'|'Unknown'} [input.tier]
 * @param {number} [input.confidence] - 0..1
 * @param {string|null} [input.userOverride] - explicit model request, skips routing;
 *   passes through verbatim (not validated against the model set)
 * @param {number|null} [input.budgetRemaining] - 0..1 fraction of budget left
 * @returns {{model: 'haiku'|'sonnet'|'opus', downgraded: boolean, reason: string}}
 */
export function decideModel({ tier, confidence = 0, userOverride = null, budgetRemaining = null } = {}) {
  // 1. User always wins.
  if (userOverride) {
    return { model: userOverride, downgraded: false, reason: 'user override' }
  }

  // 2. Normalize tier; unknown → safe default opus.
  const safeTier = TIER_MODEL[tier] ? tier : 'Unknown'

  // 3. Normalize confidence: non-finite or negative is treated as 0 (not
  //    confident). Explicit guard so the safe default does not depend on
  //    NaN-comparison semantics.
  const safeConfidence = Number.isFinite(confidence) && confidence >= 0 ? confidence : 0

  // 4. Quality-first: leave opus ONLY when confidently trivial/routine.
  const confident = safeConfidence >= DOWNGRADE_THRESHOLD
  const downgradeable = (safeTier === 'Trivial' || safeTier === 'Routine') && confident

  const model = downgradeable ? TIER_MODEL[safeTier] : 'opus'
  const reason = downgradeable
    ? `confident ${safeTier} (${safeConfidence})`
    : (safeTier === 'Hard' ? 'hard task' : 'uncertain → opus')

  // 5. Budget mode: the ONLY allowed downward override of opus.
  if (model === 'opus' && budgetRemaining !== null && budgetRemaining < BUDGET_FLOOR) {
    return { model: 'sonnet', downgraded: true, reason: `budget low (${budgetRemaining}) → opus→sonnet` }
  }

  return { model, downgraded: downgradeable, reason }
}
