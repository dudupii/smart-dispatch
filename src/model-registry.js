// Curated, versioned model registry — the tier→model resolution layer
// shared by every host adapter (spec #10).
//
// Hand-curated on purpose: a drifted table routes wrong, so the registry is
// the truth source, versioned and dated like the price table, and runtime
// provider auto-discovery may only supplement it — never override curated
// anchors. Each provider gets one ORDERED candidate pool per tier; pool
// order IS the quality order, leader first.
//
// `prefer` implements the tier-internal specialty tiebreaker under the
// formal no-quality-loss rule: a candidate may replace the pool leader only
// when it scores at least as high as the leader on the preferred dimension.
// Among qualifying candidates the higher score wins; ties go to the cheaper
// model, then to curated order.

export const MODEL_REGISTRY = Object.freeze({
  version: 1,
  asOf: '2026-09-11',
  // Strength scores are relative within the curated lineup (1–5), not
  // absolute benchmarks. Context lengths in thousands of tokens.
  models: Object.freeze({
    haiku: Object.freeze({
      relativeCost: 0.1,
      contextK: 200,
      strengths: Object.freeze({ reasoning: 3, code: 3, longContext: 3, speed: 5 }),
    }),
    sonnet: Object.freeze({
      relativeCost: 0.3,
      contextK: 200,
      strengths: Object.freeze({ reasoning: 4, code: 4, longContext: 4, speed: 4 }),
    }),
    opus: Object.freeze({
      relativeCost: 1.0,
      contextK: 200,
      strengths: Object.freeze({ reasoning: 5, code: 5, longContext: 5, speed: 2 }),
    }),
  }),
  providers: Object.freeze({
    anthropic: Object.freeze({
      pools: Object.freeze({
        Trivial: Object.freeze(['haiku']),
        Routine: Object.freeze(['sonnet']),
        Hard: Object.freeze(['opus']),
        Unknown: Object.freeze(['opus']),
      }),
    }),
  }),
})

/**
 * Resolve a tier to a concrete model from the registry.
 *
 * @param {'Trivial'|'Routine'|'Hard'|'Unknown'} [tier]
 * @param {{provider?: string, prefer?: string|null, registry?: object}} [options]
 *   `prefer` names a strengths dimension (e.g. 'longContext', 'speed') for
 *   the tier-internal tiebreaker.
 * @returns {string|null} model id, or null when the provider (or tier pool)
 *   isn't curated — callers fall back to the policy's own tier map.
 */
export function resolveModel(tier, { provider = 'anthropic', prefer = null, registry = MODEL_REGISTRY } = {}) {
  const pools = registry.providers?.[provider]?.pools
  // Unknown or missing tier → the Unknown pool (same normalization as the
  // policy's safe default).
  const pool = Array.isArray(pools?.[tier]) ? pools[tier] : pools?.Unknown
  if (!Array.isArray(pool) || pool.length === 0) return null
  const leader = pool[0]
  if (!prefer) return leader

  const score = (m) => registry.models?.[m]?.strengths?.[prefer]
  const cost = (m) => registry.models?.[m]?.relativeCost ?? Number.POSITIVE_INFINITY
  const leaderScore = score(leader)
  if (typeof leaderScore !== 'number') return leader

  let best = leader
  let bestScore = leaderScore
  for (const candidate of pool.slice(1)) {
    const s = score(candidate)
    if (typeof s !== 'number' || s < leaderScore) continue // no-quality-loss rule
    if (s > bestScore || (s === bestScore && cost(candidate) < cost(best))) {
      best = candidate
      bestScore = s
    }
  }
  return best
}
