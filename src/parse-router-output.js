// Parse the router agent's structured output into a decision object.
// Returns null on ANY malformation — the caller then falls back to opus.

const VALID_TIERS = new Set(['Trivial', 'Routine', 'Hard'])
const VALID_MODELS = new Set(['haiku', 'sonnet', 'opus'])

/**
 * @param {string} raw - raw text from the router agent
 * @returns {{tier:string,model:string,confidence:number,reason:string}|null}
 */
export function parseRouterOutput(raw) {
  if (typeof raw !== 'string') return null

  // Extract the first {...} block (router may wrap JSON in prose).
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null

  let obj
  try {
    obj = JSON.parse(match[0])
  } catch {
    return null
  }

  const tier = typeof obj.tier === 'string' ? obj.tier.trim() : ''
  const model = typeof obj.model === 'string' ? obj.model.trim() : ''
  const confidence = Number(obj.confidence)

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
