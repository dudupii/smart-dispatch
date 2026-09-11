// The normalized dispatch pipeline — the ONE seam where host adapters meet
// the core (spec #10). Hosts marshal their event into a normalized call;
// the pipeline owns override detection, retry-escalation, classification,
// the quality-first policy, and the shared routing log.
//
// Contract:
//   call:   { subagentType, prompt, description, explicitModel, host }
//   deps:   { config (from src/config.js shape), entries (array or lazy
//            () => array of parsed log entries), nowMs, logEntry (fn) }
//   result: { model, rewrite, downgraded, escalatedFrom, reason }
//     - model:    the resolved model for the LOG (always meaningful)
//     - rewrite:  the model to write into the dispatch, or null to leave
//                 the call untouched (inherit the session default)
//     - The only rewrite directions are downgrades and config-pinned
//       overrides — the "never force a model upward" invariant holds here.

import { classifyHeuristic } from './classify-heuristic.js'
import { decideModel } from './decide-model.js'
import { hashPrompt, shouldEscalate } from './escalation.js'
import { canonicalSlot, resolveModel } from './model-registry.js'

const DEFAULT_ESCALATION = { enabled: true, windowMinutes: 10 }

export function routeDispatch(call, { config = {}, entries = [], nowMs = Date.now(), logEntry = null } = {}) {
  const { subagentType = '', prompt = '', description = '', explicitModel = null, host = null } = call ?? {}
  const log = (entry) => {
    if (logEntry) logEntry(entry)
  }

  // 1. User override: any explicit model the host exposes wins outright,
  //    verbatim, and is not a routing decision (nothing logged).
  if (explicitModel && String(explicitModel).trim()) {
    return { model: explicitModel, rewrite: null, downgraded: false, escalatedFrom: null, reason: 'user override' }
  }

  // 2. Config-pinned agents. "never" opts the type out entirely (not a
  //    routing decision); a fixed model is written explicitly like an
  //    override — that is what the user configured. Legacy slot aliases
  //    canonicalize here so the log speaks one vocabulary; concrete ids
  //    pass through untouched.
  const override = config.agentOverrides?.[subagentType]
  if (override === 'never') {
    return { model: null, rewrite: null, downgraded: false, escalatedFrom: null, reason: 'agent override: never' }
  }
  if (override) {
    const slot = canonicalSlot(override)
    log({ tier: 'Override', confidence: 1, model: slot, agent: subagentType, host })
    return { model: slot, rewrite: slot, downgraded: false, escalatedFrom: null, reason: 'agent override' }
  }

  // 3. Classify with the conservative heuristics (the explicitModel skip
  //    case is unreachable — step 1 already returned).
  const h = classifyHeuristic({ subagent_type: subagentType, prompt, description })

  // 4. Self-healing: a re-dispatch of a task we routed below heavy recently.
  const hash = hashPrompt({ prompt, description })
  const escalation = { ...DEFAULT_ESCALATION, ...(config.escalation ?? {}) }
  if (hash && escalation.enabled) {
    const list = typeof entries === 'function' ? entries() : entries
    const prior = shouldEscalate({ entries: list, hash, nowMs, windowMinutes: escalation.windowMinutes })
    if (prior.escalate) {
      log({
        tier: 'Retry',
        confidence: h.confidence ?? 0,
        model: 'heavy',
        hash,
        escalatedFrom: prior.fromModel,
        agent: subagentType,
        host,
      })
      return { model: 'heavy', rewrite: null, downgraded: false, escalatedFrom: prior.fromModel, reason: 'retry → withhold downgrade' }
    }
  }

  // 5. Quality-first policy. The registry resolves the downgrade target for
  //    the configured provider (falling back to the policy's own tier map
  //    when the provider isn't curated).
  const decision = decideModel(
    { tier: h.tier, confidence: h.confidence },
    {
      downgradeThreshold: config.downgradeThreshold,
      budgetFloor: config.budgetFloor,
    },
  )
  const model = decision.downgraded
    ? (resolveModel(h.tier, { provider: config.provider }) ?? decision.model)
    : decision.model

  log({
    tier: h.tier || 'Unknown',
    confidence: h.confidence ?? 0,
    model,
    hash,
    agent: subagentType,
    host,
  })

  return {
    model,
    rewrite: decision.downgraded ? model : null,
    downgraded: decision.downgraded,
    escalatedFrom: null,
    reason: decision.reason,
  }
}
