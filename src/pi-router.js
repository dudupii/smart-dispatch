// Per-prompt routing controller for the Pi host (spec #10, Pi phase).
//
// Pi has no sub-agent dispatch: one model per session, one agent loop per
// user prompt. smart-dispatch's quality-first semantics translate as:
//   - the session's model when routing first runs is the BASE — the user's
//     chosen ceiling for quality;
//   - each user prompt goes through the shared pipeline under the
//     general-purpose gate: a confidently trivial/routine prompt steps the
//     session DOWN for that loop, everything else restores the BASE;
//   - routing NEVER selects above the BASE (no forcing a model upward), and
//     stands down permanently once the user picks a model themselves
//     (/model or Ctrl+P) — the uniform user-override rule.
//
// All decisions come from src/dispatch-pipeline.js; this module only adds
// the session-model bookkeeping that a single-model host requires.

import { routeDispatch } from './dispatch-pipeline.js'

const modelKey = (m) => (m ? `${m.provider}/${m.id}` : '')

/**
 * @param {object} deps
 * @param {(provider: string, alias: string) => object|null} deps.findModel
 *   resolve a tier alias ('haiku'|'sonnet'|'opus') to a concrete host model
 * @param {(model: object) => Promise|void} deps.setModel switch the session model
 * @param {(entry: object) => void} [deps.logEntry] shared-log writer
 * @param {() => Array} [deps.readEntries] lazy access to parsed log entries
 * @param {number} [deps.nowMs]
 * @param {object} [deps.config] from src/config.js
 */
export function createPiRouter({
  findModel,
  setModel,
  logEntry = null,
  readEntries = () => [],
  nowMs = Date.now(),
  config = {},
} = {}) {
  let base = null // the session ceiling, fixed on the first routed prompt
  let pinned = false // the user picked a model — routing stands down

  return {
    /**
     * Route one user prompt (a `before_agent_start` event).
     * @param {string} prompt
     * @param {{model: object, modelRegistry?: {find: Function}}} [ctx] host context
     * @returns {Promise<object|null>} the pipeline decision, or null when no
     *   routing happened (pinned, or no model context)
     */
    async onPrompt(prompt, ctx) {
      if (pinned) return null
      const current = ctx?.model
      if (!current) return null
      if (!base) base = current // first routed prompt fixes the ceiling

      const decision = routeDispatch(
        {
          subagentType: 'general-purpose', // the conservative narrow gate
          prompt,
          description: '',
          explicitModel: null,
          host: 'pi',
        },
        { config, entries: readEntries, nowMs, logEntry },
      )

      // Downgrades resolve the tier alias to a concrete host model — via the
      // host's own registry when the context carries one, else the injected
      // resolver; anything else restores the base. Never above base.
      const resolve = (alias) =>
        (ctx?.modelRegistry && ctx.modelRegistry.find?.(current.provider, alias)) ??
        findModel?.(current.provider, alias) ??
        null
      const targetModel = decision.rewrite ? resolve(decision.rewrite) : base
      if (!targetModel) return decision // unresolvable alias → stay put (safe)
      if (modelKey(targetModel) === modelKey(current)) return decision

      await setModel?.(targetModel)
      return decision
    },

    /**
     * A `model_select` event. 'set'/'cycle' are user actions (override — pin
     * routing off); 'restore' is session restore/initial --model (not a pin).
     */
    onModelSelect(source) {
      if (source === 'set' || source === 'cycle') pinned = true
    },

    isPinned: () => pinned,
  }
}
