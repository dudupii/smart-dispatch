#!/usr/bin/env node
// smart-dispatch — the Codex CLI adapter (spec #10, Codex phase).
//
// Codex exposes PreToolUse with block + updatedInput rewriting (same shape
// as Claude Code). Sub-agent spawns (spawn_agent / collaboration.spawn_agent)
// match the "Agent" matcher. Two routing modes, probed per call:
//
//   rewrite mode — when the spawn schema allows setting a model (older
//     schema, or multi-agent V2 with hide_spawn_agent_metadata = false) and
//     the spawn itself did NOT name one (it would inherit the session
//     default), a confident downgrade writes the tier's model id in place.
//     Ids come from the user's config (codex.models per tier) — OpenAI ids
//     are not curated in the shared registry (v1 is Anthropic-only), so
//     unconfigured tiers fall through to veto mode. A spawn that DOES name
//     a model is an explicit choice — the uniform override rule skips it.
//
//   veto mode — when model metadata is hidden (the V2 default), a confident
//     downgrade DENIES the spawn with a reason naming the pre-pinned tier
//     agent to re-dispatch to (see codex/agents/*.toml). One extra
//     round-trip; quality never at risk. Hard/uncertain tasks always pass.
//
// Failure policy: any error → emit `{}` and exit 0. A routing hook must
// never block or break a spawn.

import { routeDispatch } from '../../src/dispatch-pipeline.js'
import { loadConfig } from '../../src/config.js'
import { appendLogEntry, readLogTail } from '../../src/routing-log.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

  if (payload.tool_name !== 'Agent' && payload.tool_name !== 'spawn_agent') return emitEmpty()

  const toolInput = payload.tool_input || {}
  if (!toolInput || typeof toolInput !== 'object') return emitEmpty()

  const config = loadConfig()
  const dryRun = ['1', 'true'].includes(String(process.env.SMART_DISPATCH_DRY || '').toLowerCase())

  // Normalize the spawn: V2 exposes task_name + message; metadata-visible
  // schemas add agent_type/model/reasoning_effort.
  const message = toolInput.message ?? toolInput.prompt ?? ''
  const decision = routeDispatch(
    {
      subagentType: toolInput.agent_type || 'general-purpose',
      prompt: message,
      description: toolInput.task_name || '',
      explicitModel: toolInput.model || null,
      host: 'codex',
    },
    {
      config,
      entries: () => readLogTail(logPath()),
      logEntry: (entry) => appendLogEntry(logPath(), entry),
    },
  )

  if (!decision.downgraded || dryRun) return emitEmpty()

  // Rewrite mode: on a spawn that did not name a model (inherit case), a
  // configured tier→model mapping writes the model in place. Keys are the
  // tier's model aliases (haiku/sonnet). Spawns that DID name a model were
  // already skipped as explicit choices by the pipeline.
  const rewriteModel = config.codex?.models?.[decision.model] ?? null
  if (toolInput.model === undefined && rewriteModel) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: { ...toolInput, model: rewriteModel },
        },
      }),
    )
    return
  }

  // Veto mode: deny with the pinned tier agent to re-dispatch to.
  const pinnedAgent =
    config.codex?.agents?.[decision.model] ??
    { haiku: 'smart-dispatch-explorer', sonnet: 'smart-dispatch-worker' }[decision.model] ??
    'smart-dispatch-explorer'
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        reason: `smart-dispatch: this looks like a confident ${decision.model}-tier task — re-dispatch it to the pinned agent "${pinnedAgent}" (codex/agents/) instead. Re-send unchanged if you disagree.`,
      },
    }),
  )
}

main().catch(() => emitEmpty())
