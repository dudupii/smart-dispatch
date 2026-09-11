// Parse and summarize the smart-dispatch routing log.
// Log lines are JSON:
//   {"ts":"...","tier":"Trivial","confidence":0.92,"model":"light","host":"claude-code",
//    "hash":"ab12...","agent":"Explore","escalatedFrom":"light"}   (all optional but ts/model)
// `hash` is a one-way digest of the task text — the text itself is never logged.
// `host` names the dispatching agent: claude-code | pi | codex.
// `model` is the canonical slot (light/mid/heavy); pre-v0.5.0 entries say
// haiku/sonnet/opus and are canonicalized for display and metrics.

import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { computeMetrics } from './compute-metrics.js'
import { canonicalSlot } from './model-registry.js'

/**
 * Best-effort append of one routing entry. Never throws — logging must not
 * break a dispatch. Same shape as skills/smart-dispatch/SKILL.md step 5.
 * @param {string} logPath
 * @param {{tier: string, confidence: number, model: string, host?: string,
 *   hash?: string|null, escalatedFrom?: string|null, agent?: string|null}} entry
 */
export function appendLogEntry(logPath, entry) {
  try {
    const { tier, confidence, model, hash = null, escalatedFrom = null, agent = null, host = null } = entry ?? {}
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(
      logPath,
      JSON.stringify({
        ts: new Date().toISOString(),
        tier,
        confidence,
        model,
        ...(host ? { host } : {}),
        ...(hash ? { hash } : {}),
        ...(escalatedFrom ? { escalatedFrom } : {}),
        ...(agent ? { agent } : {}),
      }) + '\n',
    )
  } catch {
    // never break the tool call over logging
  }
}

/**
 * Read only the tail of the log — enough history for retry matching without
 * paying full-file I/O on every dispatch. A truncated first line simply fails
 * JSON.parse and is skipped by parseLog. Returns [] when unreadable.
 * @param {string} path
 * @param {number} [maxBytes]
 */
export function readLogTail(path, maxBytes = 65536) {
  try {
    const { size } = statSync(path)
    const len = Math.min(size, maxBytes)
    const buf = Buffer.alloc(len)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buf, 0, len, size - len)
    } finally {
      closeSync(fd)
    }
    return parseLog(buf.toString('utf8'))
  } catch {
    return [] // missing/unreadable log → nothing to escalate from
  }
}

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
 * Model names are canonicalized (legacy haiku/sonnet/opus → light/mid/heavy)
 * so a log spanning the v0.5.0 vocabulary switch still groups and prices
 * coherently.
 *
 * `hardDowngraded` is the fraction of router-classified Hard tasks routed below
 * heavy — normally 0; >0 means budget mode stepped heavy down. It is NOT a
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
  const canonical = (entries ?? []).map((e) =>
    e && typeof e.model === 'string' && e.model !== canonicalSlot(e.model)
      ? { ...e, model: canonicalSlot(e.model) }
      : e
  )
  const outcomes = canonical.map((e) => ({ trueTier: e.tier, chosenModel: e.model }))
  const metrics = computeMetrics(outcomes, relativeCost ? { relativeCost } : {})
  return {
    count: canonical.length,
    byModel: countBy(canonical, 'model'),
    byTier: countBy(canonical, 'tier'),
    byAgent: countBy(canonical, 'agent'),
    byHost: countBy(canonical, 'host'),
    escalations: canonical.filter((e) => e && typeof e.escalatedFrom === 'string').length,
    savingsRate: metrics.savingsRate,
    hardDowngraded: metrics.falseDowngradeRate,
    recent: canonical.slice(-10),
  }
}
