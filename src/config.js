// User configuration — tuning knobs as DATA, not source edits.
//
// Precedence (low → high): built-in defaults → config file → environment.
// The config file lives at $SMART_DISPATCH_CONFIG or ~/.smart-dispatch/config.json:
//
//   {
//     "downgradeThreshold": 0.8,
//     "budgetFloor": 0.1,
//     "escalation": { "enabled": true, "windowMinutes": 10 },
//     "agentOverrides": { "my-file-finder": "haiku", "my-careful-agent": "never" },
//     "priceTable": { "haiku": 0.1, "sonnet": 0.3, "opus": 1.0 }
//   }
//
// agentOverrides maps a subagent_type to a fixed model (routed verbatim, like
// a user override — never validated) or "never" to leave that type untouched.
//
// This module must never throw: the hook imports it, and a routing hook must
// never break a tool call. Invalid values fall back to the previous layer.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_CONFIG = Object.freeze({
  downgradeThreshold: 0.8, // confidence required to leave opus (see decide-model.js)
  budgetFloor: 0.1,        // budget fraction below which opus may step down
  escalation: Object.freeze({
    enabled: true,         // re-dispatch of a recently downgraded task → escalate to opus
    windowMinutes: 10,     // how recent counts as "re-dispatch"
  }),
  agentOverrides: Object.freeze({}),
  priceTable: null,        // optional relative-cost override; null = use the built-in table
})

function configFilePath(env) {
  return env.SMART_DISPATCH_CONFIG || join(homedir(), '.smart-dispatch', 'config.json')
}

function fraction(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n)) // clamp into [0, 1]
}

function positiveNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const FALSY = new Set(['0', 'false', 'off', 'no'])

/**
 * Load the effective config. Errors are contained: a missing/unreadable/
 * malformed file or invalid values never throw — the offending layer is
 * ignored and the previous one stands.
 *
 * @param {{env?: object, configPath?: string}} [options]
 * @returns {{
 *   downgradeThreshold: number, budgetFloor: number,
 *   escalation: {enabled: boolean, windowMinutes: number},
 *   agentOverrides: Object<string, string>, priceTable: Object|null,
 *   configPath: string
 * }}
 */
export function loadConfig({ env = process.env, configPath } = {}) {
  const config = {
    downgradeThreshold: DEFAULT_CONFIG.downgradeThreshold,
    budgetFloor: DEFAULT_CONFIG.budgetFloor,
    escalation: { ...DEFAULT_CONFIG.escalation },
    agentOverrides: {},
    priceTable: null,
    configPath: configPath || configFilePath(env),
  }

  // Layer 1: config file.
  let file = null
  try {
    file = JSON.parse(readFileSync(config.configPath, 'utf8'))
  } catch {
    // missing or malformed → defaults stand (a missing file is the normal case;
    // a malformed one warns so the user notices their config is being ignored)
    if (env.SMART_DISPATCH_CONFIG) {
      process.stderr.write(`smart-dispatch: ignoring invalid config file at ${config.configPath}\n`)
    }
  }
  if (file && typeof file === 'object') {
    if ('downgradeThreshold' in file) config.downgradeThreshold = fraction(file.downgradeThreshold, config.downgradeThreshold)
    if ('budgetFloor' in file) config.budgetFloor = fraction(file.budgetFloor, config.budgetFloor)
    if (file.escalation && typeof file.escalation === 'object') {
      if (typeof file.escalation.enabled === 'boolean') config.escalation.enabled = file.escalation.enabled
      if ('windowMinutes' in file.escalation) config.escalation.windowMinutes = positiveNumber(file.escalation.windowMinutes, config.escalation.windowMinutes)
    }
    if (file.agentOverrides && typeof file.agentOverrides === 'object') {
      for (const [type, model] of Object.entries(file.agentOverrides)) {
        if (typeof type === 'string' && type.trim() && typeof model === 'string' && model.trim()) {
          config.agentOverrides[type.trim()] = model.trim()
        }
      }
    }
    if (file.priceTable && typeof file.priceTable === 'object') {
      const table = {}
      for (const key of ['haiku', 'sonnet', 'opus']) {
        if (Number.isFinite(file.priceTable[key]) && file.priceTable[key] > 0) {
          table[key] = file.priceTable[key]
        }
      }
      if (Object.keys(table).length === 3) config.priceTable = table // partial tables would skew savings
    }
  }

  // Layer 2: environment — the fastest knob and the kill switches.
  if (env.SMART_DISPATCH_THRESHOLD !== undefined) {
    config.downgradeThreshold = fraction(env.SMART_DISPATCH_THRESHOLD, config.downgradeThreshold)
  }
  if (env.SMART_DISPATCH_BUDGET_FLOOR !== undefined) {
    config.budgetFloor = fraction(env.SMART_DISPATCH_BUDGET_FLOOR, config.budgetFloor)
  }
  if (env.SMART_DISPATCH_ESCALATION !== undefined) {
    config.escalation.enabled = !FALSY.has(String(env.SMART_DISPATCH_ESCALATION).toLowerCase())
  }

  return config
}
