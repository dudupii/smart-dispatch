#!/usr/bin/env node
// smart-dispatch PreToolUse hook — transparent model routing for Agent calls.
//
// Fires whenever the Agent tool is about to run. If the model already named a
// model, we respect it. Otherwise we classify the task with cheap heuristics
// (src/classify-heuristic.js) and apply the canonical policy (src/decide-model.js).
// We rewrite `model` via updatedInput ONLY when the policy downgrades; in every
// other case we return an empty payload so the call proceeds untouched.
//
// Decisions are appended to the routing log in the same format the skill uses,
// so `/smart-dispatch-report` reflects hook-routed activity too.
//
// Failure policy: any error → emit `{}` and exit 0. A routing hook must never
// block or break a tool call.

import { decideModel } from '../src/decide-model.js'
import { classifyHeuristic } from '../src/classify-heuristic.js'
import { loadConfig } from '../src/config.js'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
  })
}

function logDecision({ tier, confidence, model }) {
  // Best-effort, same shape as skills/smart-dispatch/SKILL.md step 4.
  try {
    const logPath =
      process.env.SMART_DISPATCH_LOG || join(homedir(), '.smart-dispatch', 'log.jsonl')
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(
      logPath,
      JSON.stringify({ ts: new Date().toISOString(), tier, confidence, model }) + '\n',
    )
  } catch {
    // never break the tool call over logging
  }
}

function emitEmpty() {
  process.stdout.write('{}')
}

async function main() {
  const raw = await readStdin()

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return emitEmpty() // malformed stdin → no-op
  }

  // Only intercept Agent tool calls.
  if (payload.tool_name !== 'Agent') return emitEmpty()

  const toolInput = payload.tool_input || {}
  if (!toolInput || typeof toolInput !== 'object') return emitEmpty()

  // Respect an explicit model choice (user or model-set) — treat as override.
  if (toolInput.model && String(toolInput.model).trim()) return emitEmpty()

  const config = loadConfig()

  // Dry-run: classify and log as usual, but never rewrite the call. Lets a
  // cautious user preview routing decisions before letting the hook act.
  const dryRun = ['1', 'true'].includes(String(process.env.SMART_DISPATCH_DRY || '').toLowerCase())

  // Per-agent-type overrides from the config file — the user's fixed routing
  // for known agents, checked before heuristics. "never" disables routing for
  // that type entirely (no log entry — it is not a routing decision).
  const override = config.agentOverrides[toolInput.subagent_type]
  if (override === 'never') return emitEmpty()
  if (override) {
    logDecision({ tier: 'Override', confidence: 1, model: override })
    if (dryRun) return emitEmpty()
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: { ...toolInput, model: override },
        },
      }),
    )
    return
  }

  const h = classifyHeuristic({
    subagent_type: toolInput.subagent_type,
    prompt: toolInput.prompt,
    description: toolInput.description,
    model: toolInput.model,
  })
  if (h.skip) return emitEmpty()

  const decision = decideModel(
    { tier: h.tier, confidence: h.confidence },
    { downgradeThreshold: config.downgradeThreshold, budgetFloor: config.budgetFloor },
  )

  // Log every routed decision (including non-downgrades) for report visibility.
  logDecision({ tier: h.tier || 'Unknown', confidence: h.confidence ?? 0, model: decision.model })

  // Only rewrite on an actual downgrade. Otherwise leave the call untouched —
  // an empty `model` inherits the session default (usually opus), which is
  // exactly what we want for Hard/uncertain tasks. In dry-run, never rewrite.
  if (!decision.downgraded || dryRun) return emitEmpty()

  // updatedInput REPLACES tool_input — echo the full object, only model changed.
  const updatedInput = { ...toolInput, model: decision.model }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput,
      },
    }),
  )
}

main().catch(() => emitEmpty())
