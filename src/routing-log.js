// Parse and summarize the smart-dispatch routing log.
// Log lines are JSON:
//   {"ts":"...","tier":"Trivial","confidence":0.92,"model":"haiku",
//    "hash":"ab12...","agent":"Explore","escalatedFrom":"haiku"}   (all optional)
// `hash` is a one-way digest of the task text — the text itself is never logged.
import { computeMetrics } from './compute-metrics.js'

/**
 * Parse JSONL log text into entries, skipping blank/malformed lines and
 * entries missing the required `model` field.
 * @param {string} text
 * @returns {Array<{ts?:string, tier?:string, confidence?:number, model: string, hash?:string, escalatedFrom?:string, agent?:string}>}
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
 * Keep only entries timestamped at/after `sinceMs`. Entries without a
 * parseable timestamp are dropped (can't prove they're in the window).
 * @param {Array} entries
 * @param {number} sinceMs epoch milliseconds
 */
export function filterSince(entries, sinceMs) {
  if (!Array.isArray(entries)) return []
  return entries.filter((e) => {
    const ts = Date.parse(e?.ts)
    return Number.isFinite(ts) && ts >= sinceMs
  })
}

const countBy = (entries, key) =>
  entries.reduce((m, e) => {
    if (e && typeof e[key] === 'string' && e[key]) {
      m[e[key]] = (m[e[key]] || 0) + 1
    }
    return m
  }, {})

/**
 * Summarize parsed log entries into a report object.
 *
 * `hardDowngraded` is the fraction of router-classified Hard tasks routed below
 * opus — normally 0; >0 means budget mode stepped opus down. It is NOT a
 * ground-truth quality metric (production has no labels); the labeled eval in
 * eval/ measures true false-downgrade rate.
 *
 * `escalations` counts self-healed retries (entries with `escalatedFrom`).
 *
 * @param {Array} entries
 * @param {{relativeCost?: Object<string, number>}} [options]
 * @returns {{count: number, byModel: Object, byTier: Object, byAgent: Object,
 *   escalations: number, savingsRate: number|null, hardDowngraded: number|null, recent: Array}}
 */
export function summarizeEntries(entries, { relativeCost } = {}) {
  const outcomes = entries.map((e) => ({ trueTier: e.tier, chosenModel: e.model }))
  const metrics = computeMetrics(outcomes, relativeCost ? { relativeCost } : {})
  return {
    count: entries.length,
    byModel: countBy(entries, 'model'),
    byTier: countBy(entries, 'tier'),
    byAgent: countBy(entries, 'agent'),
    escalations: entries.filter((e) => e && typeof e.escalatedFrom === 'string').length,
    savingsRate: metrics.savingsRate,
    hardDowngraded: metrics.falseDowngradeRate,
    recent: entries.slice(-10),
  }
}
