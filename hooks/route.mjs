#!/usr/bin/env node
// smart-dispatch PreToolUse hook — the Claude Code adapter.
//
// Pure marshalling over the shared dispatch pipeline (src/dispatch-pipeline.js):
// translate the PreToolUse payload into a normalized call, hand it to the
// pipeline, and translate the decision back — a rewrite becomes updatedInput,
// anything else passes through untouched (dry-run suppresses rewrites).
//
// Decisions are appended to the shared routing log in the same format the
// skill uses, so `/smart-dispatch-report` reflects hook-routed activity too.
//
// Failure policy: any error → emit `{}` and exit 0. A routing hook must never
// block or break a tool call.

import { routeDispatch } from '../src/dispatch-pipeline.js'
import { loadConfig } from '../src/config.js'
import { appendLogEntry, readLogTail } from '../src/routing-log.js'
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

  // Only intercept Agent tool calls.
  if (payload.tool_name !== 'Agent') return emitEmpty()

  const toolInput = payload.tool_input || {}
  if (!toolInput || typeof toolInput !== 'object') return emitEmpty()

  const config = loadConfig()

  // Dry-run: classify and log as usual, but never rewrite the call. Lets a
  // cautious user preview routing decisions before letting the hook act.
  const dryRun = ['1', 'true'].includes(String(process.env.SMART_DISPATCH_DRY || '').toLowerCase())

  const decision = routeDispatch(
    {
      subagentType: toolInput.subagent_type,
      prompt: toolInput.prompt,
      description: toolInput.description,
      explicitModel: toolInput.model || null,
      host: 'claude-code',
    },
    {
      config,
      entries: () => readLogTail(logPath()), // lazy — skipped unless escalation needs it
      logEntry: (entry) => appendLogEntry(logPath(), entry),
    },
  )

  // Rewrite ONLY on an actual downgrade or config-pinned override (and never
  // in dry-run). Otherwise the call proceeds untouched — an empty `model`
  // inherits the session default, which is exactly what we want.
  if (!decision.rewrite || dryRun) return emitEmpty()

  // updatedInput REPLACES tool_input — echo the full object, only model changed.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { ...toolInput, model: decision.rewrite },
      },
    }),
  )
}

main().catch(() => emitEmpty())
