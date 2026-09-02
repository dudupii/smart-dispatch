#!/usr/bin/env node
// smart-dispatch PreToolUse hook — transparent model routing for Agent calls.
//
// Fires whenever the Agent tool is about to run. If the model already named a
// model, we respect it. Otherwise:
//   1. config-file agent overrides win first (fixed model, or "never"),
//   2. a recent same-task re-dispatch of a downgraded route escalates back to
//      the session default (self-healing, src/escalation.js),
//   3. otherwise we classify the task with cheap heuristics
//      (src/classify-heuristic.js) and apply the canonical policy
//      (src/decide-model.js).
// We rewrite `model` via updatedInput ONLY when the policy downgrades (and not
// in dry-run); in every other case we return an empty payload so the call
// proceeds untouched.
//
// Decisions are appended to the routing log in the same format the skill uses,
// so `/smart-dispatch-report` reflects hook-routed activity too.
//
// Failure policy: any error → emit `{}` and exit 0. A routing hook must never
// block or break a tool call.

import { decideModel } from '../src/decide-model.js'
import { classifyHeuristic } from '../src/classify-heuristic.js'
import { loadConfig } from '../src/config.js'
import { hashPrompt, shouldEscalate } from '../src/escalation.js'
import { parseLog } from '../src/routing-log.js'
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
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

function logPath() {
  return process.env.SMART_DISPATCH_LOG || join(homedir(), '.smart-dispatch', 'log.jsonl')
}

function logDecision({ tier, confidence, model, hash = null, escalatedFrom = null, agent = null }) {
  // Best-effort, same shape as skills/smart-dispatch/SKILL.md step 4.
  // `hash` is a one-way digest of the task text (never the text itself);
  // `agent` is the subagent_type; `escalatedFrom` marks a self-healed retry.
  try {
    mkdirSync(dirname(logPath()), { recursive: true })
    appendFileSync(
      logPath(),
      JSON.stringify({
        ts: new Date().toISOString(),
        tier,
        confidence,
        model,
        ...(hash ? { hash } : {}),
        ...(escalatedFrom ? { escalatedFrom } : {}),
        ...(agent ? { agent } : {}),
      }) + '\n',
    )
  } catch {
    // never break the tool call over logging
  }
}

// Read only the tail of the log — enough history for retry matching without
// paying full-file I/O on every Agent call. A truncated first line simply
// fails JSON.parse and is skipped by parseLog.
function readLogTail(path, maxBytes = 65536) {
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
    logDecision({ tier: 'Override', confidence: 1, model: override, agent: toolInput.subagent_type })
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

  // Self-healing: this same task (by one-way prompt hash) dispatched recently
  // and we routed it below opus → the re-dispatch says the cheap model didn't
  // cut it. Skip the downgrade and let the call inherit the session default
  // (normally opus). We still never WRITE an explicit model here — escalation
  // is the absence of a downgrade, so the "never force a model" invariant
  // holds even while recovering.
  const hash = hashPrompt({ prompt: toolInput.prompt, description: toolInput.description })
  let escalatedFrom = null
  if (hash && config.escalation.enabled) {
    const prior = shouldEscalate({
      entries: readLogTail(logPath()),
      hash,
      windowMinutes: config.escalation.windowMinutes,
    })
    if (prior.escalate) escalatedFrom = prior.fromModel
  }
  if (escalatedFrom) {
    logDecision({
      tier: 'Retry',
      confidence: h.confidence ?? 0,
      model: 'opus',
      hash,
      escalatedFrom,
      agent: toolInput.subagent_type,
    })
    return emitEmpty()
  }

  const decision = decideModel(
    { tier: h.tier, confidence: h.confidence },
    { downgradeThreshold: config.downgradeThreshold, budgetFloor: config.budgetFloor },
  )

  // Log every routed decision (including non-downgrades) for report visibility.
  logDecision({
    tier: h.tier || 'Unknown',
    confidence: h.confidence ?? 0,
    model: decision.model,
    hash,
    agent: toolInput.subagent_type,
  })

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
