// Quality-first model selection policy.
// This is the SINGLE SOURCE OF TRUTH for routing decisions.
// skills/smart-dispatch/SKILL.md mirrors these rules — keep them in sync.

export const DOWNGRADE_THRESHOLD = 0.8 // confidence required to leave heavy
export const BUDGET_FLOOR = 0.1        // below this remaining-budget fraction, heavy may step down

// Tier → canonical slot (light/mid/heavy — host-neutral; adapters resolve
// wire names at their own boundary). Mirrored by the registry's pools.
const TIER_MODEL = {
  Trivial: 'light',
  Routine: 'mid',
  Hard: 'heavy',
  Unknown: 'heavy',
}

/**
 * @param {object} input
 * @param {'Trivial'|'Routine'|'Hard'|'Unknown'} [input.tier]
 * @param {number} [input.confidence] - 0..1
 * @param {string|null} [input.userOverride] - explicit model request, skips routing;
 *   passes through verbatim (not validated against the model set). Pinned-agent
 *   overrides (config agentOverrides, Codex custom-agent pins) are resolved at
 *   the host-adapter layer before this policy is consulted — same semantics.
 * @param {number|null} [input.budgetRemaining] - 0..1 fraction of budget left
 * @param {object} [config] - overrides from src/config.js (defaults = the
 *   exported constants above; injecting keeps this function pure)
 * @returns {{model: 'light'|'mid'|'heavy', downgraded: boolean, reason: string}}
 */
export function decideModel(
  { tier, confidence = 0, userOverride = null, budgetRemaining = null } = {},
  { downgradeThreshold = DOWNGRADE_THRESHOLD, budgetFloor = BUDGET_FLOOR } = {},
) {
  // 1. User always wins.
  if (userOverride) {
    return { model: userOverride, downgraded: false, reason: 'user override' }
  }

  // 2. Normalize tier; unknown → safe default heavy.
  const safeTier = TIER_MODEL[tier] ? tier : 'Unknown'

  // 3. Normalize confidence: non-finite or negative is treated as 0 (not
  //    confident). Explicit guard so the safe default does not depend on
  //    NaN-comparison semantics.
  const safeConfidence = Number.isFinite(confidence) && confidence >= 0 ? confidence : 0

  // 4. Quality-first: leave heavy ONLY when confidently trivial/routine.
  const confident = safeConfidence >= downgradeThreshold
  const downgradeable = (safeTier === 'Trivial' || safeTier === 'Routine') && confident

  const model = downgradeable ? TIER_MODEL[safeTier] : 'heavy'
  const reason = downgradeable
    ? `confident ${safeTier} (${safeConfidence})`
    : (safeTier === 'Hard' ? 'hard task' : 'uncertain → heavy')

  // 5. Budget mode: the ONLY allowed downward override of heavy.
  if (model === 'heavy' && budgetRemaining !== null && budgetRemaining < budgetFloor) {
    return { model: 'mid', downgraded: true, reason: `budget low (${budgetRemaining}) → heavy→mid` }
  }

  return { model, downgraded: downgradeable, reason }
}
