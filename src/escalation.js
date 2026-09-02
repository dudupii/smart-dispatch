// Retry-escalation: self-healing for downgrades that were wrong.
//
// When a task we routed below opus comes back — the model re-dispatched the
// same thing shortly after — that re-dispatch is strong evidence the cheap
// model didn't cut it. The hook then skips the downgrade and lets the call
// inherit the session default (normally opus), turning a quality loss into
// one cheap attempt + automatic correction.
//
// Privacy invariant: the log never stores task text. Matching is done on a
// short one-way hash of the normalized prompt — enough to recognize "same
// task again", not enough to reconstruct anything about it.

import { createHash } from 'node:crypto'

/**
 * Stable short hash of a task's identity. Normalizes whitespace so a literal
 * re-paste still matches; combines description + prompt (the visible task).
 * @returns {string|null} 10 hex chars, or null when there is nothing to hash.
 */
export function hashPrompt({ prompt = '', description = '' } = {}) {
  const normalized = `${description || ''}\n${prompt || ''}`.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return createHash('sha256').update(normalized).digest('hex').slice(0, 10)
}

/**
 * Decide whether this dispatch is a retry of a recently downgraded task.
 *
 * @param {object} input
 * @param {Array<{ts?:string, model?:string, hash?:string, escalatedFrom?:string}>} input.entries
 *   parsed log entries, oldest → newest (log append order)
 * @param {string|null} input.hash - hash of the current task
 * @param {number} [input.nowMs] - epoch ms "now" (injectable for tests)
 * @param {number} [input.windowMinutes] - how recent counts as a retry
 * @returns {{escalate: boolean, fromModel: string|null}}
 */
export function shouldEscalate({
  entries,
  hash,
  nowMs = Date.now(),
  windowMinutes = 10,
} = {}) {
  if (!hash || !Array.isArray(entries)) return { escalate: false, fromModel: null }

  const windowMs = windowMinutes * 60_000
  // Newest first: the most recent matching dispatch is the one being retried.
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (!e || e.hash !== hash) continue
    if (e.escalatedFrom) continue // already escalated once — no chains
    const ts = Date.parse(e.ts)
    if (!Number.isFinite(ts)) continue // undatable entry — can't prove recency
    const age = nowMs - ts
    if (age < 0 || age > windowMs) continue // stale (or clock-skewed) — not a retry
    // Same task, recently routed below opus → escalate. If it already ran on
    // opus there is nothing to fix.
    if (typeof e.model === 'string' && e.model !== 'opus') {
      return { escalate: true, fromModel: e.model }
    }
    return { escalate: false, fromModel: null }
  }
  return { escalate: false, fromModel: null }
}
