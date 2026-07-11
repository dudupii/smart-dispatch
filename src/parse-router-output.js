const VALID_TIERS = new Set(['Trivial', 'Routine', 'Hard'])
const VALID_MODELS = new Set(['haiku', 'sonnet', 'opus'])

// Validate a parsed object into a decision, or null if invalid/incomplete.
function validate(obj) {
  const tier = typeof obj?.tier === 'string' ? obj.tier.trim() : ''
  const model = typeof obj?.model === 'string' ? obj.model.trim() : ''
  const confidence = Number(obj?.confidence)
  if (!VALID_TIERS.has(tier)) return null
  if (!VALID_MODELS.has(model)) return null
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null
  return {
    tier,
    model,
    confidence,
    reason: typeof obj.reason === 'string' ? obj.reason : '',
  }
}

/**
 * Parse the router agent's structured output into a decision object.
 * The router may wrap JSON in prose or echo the schema before answering,
 * so every {...} span is tried and the first valid decision is returned.
 *
 * NOTE: the `model` field is the router's *suggestion*; `decideModel` is
 * authoritative and re-derives the choice from tier + confidence. Do not
 * trust `parsed.model` directly.
 *
 * @param {string} raw - raw text from the router agent
 * @returns {{tier:string,model:string,confidence:number,reason:string}|null}
 *   Returns null on any malformation — the caller then falls back to opus.
 */
export function parseRouterOutput(raw) {
  if (typeof raw !== 'string') return null

  const candidates = raw.match(/\{[\s\S]*?\}/g) ?? []
  for (const candidate of candidates) {
    let obj
    try {
      obj = JSON.parse(candidate)
    } catch {
      continue
    }
    const result = validate(obj)
    if (result) return result
  }
  return null
}
