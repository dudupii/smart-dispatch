// Parse and summarize the smart-dispatch routing log.
// Log lines are JSON: {"ts":"...","tier":"Trivial","confidence":0.92,"model":"haiku"}
// Only tier/confidence/model/timestamp are ever logged — never task text.
import { computeMetrics } from './compute-metrics.js'

/**
 * Parse JSONL log text into entries, skipping blank/malformed lines and
 * entries missing the required `model` field.
 * @param {string} text
 * @returns {Array<{ts?:string, tier?:string, confidence?:number, model: string}>}
 */
export function parseLog(text) {
  if (typeof text !== 'string') return []
  const entries = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (obj && typeof obj.model === 'string') entries.push(obj)
  }
  return entries
}

/**
 * Summarize parsed log entries into a report object.
 *
 * `hardDowngraded` is the fraction of router-classified Hard tasks routed below
 * opus — normally 0; >0 means budget mode stepped opus down. It is NOT a
 * ground-truth quality metric (production has no labels); the labeled eval in
 * eval/ measures true false-downgrade rate.
 *
 * @param {Array} entries
 * @returns {{count: number, byModel: Object, savingsRate: number|null, hardDowngraded: number|null, recent: Array}}
 */
export function summarizeEntries(entries) {
  const outcomes = entries.map((e) => ({ trueTier: e.tier, chosenModel: e.model }))
  const metrics = computeMetrics(outcomes)
  const byModel = entries.reduce((m, e) => {
    m[e.model] = (m[e.model] || 0) + 1
    return m
  }, {})
  return {
    count: entries.length,
    byModel,
    savingsRate: metrics.savingsRate,
    hardDowngraded: metrics.falseDowngradeRate,
    recent: entries.slice(-10),
  }
}
