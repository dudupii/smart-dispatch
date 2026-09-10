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

// Best-effort log writer — same shape as skills/smart-dispatch/SKILL.md step 5.
// `hash` is a one-way digest of the task text (never the text itself);
// `agent` is the subagent type; `escalatedFrom` marks a self-healed retry;
// `host` identifies the dispatching agent (claude-code / pi / codex).
function writeLogEntry({ tier, confidence, model, hash = null, escalatedFrom = null, agent = null, host = 'claude-code' }) {
  try {
    mkdirSync(dirname(logPath()), { recursive: true })
    appendFileSync(
      logPath(),
      JSON.stringify({
        ts: new Date().toISOString(),
        tier,
        confidence,
        model,
        host,
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
      logEntry: writeLogEntry,
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
