// End-to-end integration test for the PreToolUse hook binary.
//
// Unlike classify-heuristic.test.js (which unit-tests the classifier in
// process), this spawns the REAL hooks/route.mjs as Claude Code would —
// piping a PreToolUse JSON payload to stdin and asserting on the JSON the
// hook writes to stdout. It guards the contract that `claude plugin details`
// relies on: emit `{}` to no-op, or `{hookSpecificOutput:{updatedInput,...}}`
// to rewrite the model in place. A malformed hooks.json or a broken
// updatedInput shape would be caught here, not by the unit tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK = join(__dirname, '..', 'hooks', 'route.mjs')

// Run the hook with the given tool_name/tool_input and return parsed stdout.
// `extra` lets tests inject env (e.g. SMART_DISPATCH_LOG) or a raw stdin.
function runHook({ tool_name = 'Agent', tool_input = {}, env = {}, stdin } = {}) {
  const payload = stdin ?? JSON.stringify({ tool_name, tool_input })
  const res = spawnSync('node', [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  assert.equal(res.status, 0, `hook exited ${res.status}\nstderr: ${res.stderr}`)
  const out = res.stdout.trim()
  return out === '' ? {} : JSON.parse(out)
}

test('downgrades a short read-only Explore search to haiku via updatedInput', () => {
  const r = runHook({
    tool_input: {
      subagent_type: 'Explore',
      description: 'find usages',
      prompt: 'find all usages of decideModel in the repo',
    },
  })
  assert.equal(r.hookSpecificOutput.permissionDecision, 'allow')
  assert.equal(r.hookSpecificOutput.updatedInput.model, 'haiku')
})

test('updatedInput preserves the rest of tool_input (only model changes)', () => {
  const r = runHook({
    tool_input: {
      subagent_type: 'Explore',
      description: 'find',
      prompt: 'find the function',
      extra_field: 'keep-me',
      prompt_queue: [1, 2, 3],
    },
  })
  const u = r.hookSpecificOutput.updatedInput
  assert.equal(u.model, 'haiku')
  assert.equal(u.subagent_type, 'Explore')
  assert.equal(u.extra_field, 'keep-me')
  assert.deepEqual(u.prompt_queue, [1, 2, 3])
})

test('explicit model is respected — emits {} (no rewrite)', () => {
  const r = runHook({
    tool_input: { subagent_type: 'Explore', prompt: 'find foo', model: 'opus' },
  })
  assert.deepEqual(r, {})
})

test('non-Agent tools are a no-op — emits {}', () => {
  for (const tool_name of ['Read', 'Write', 'Bash', 'Edit']) {
    const r = runHook({ tool_name, tool_input: { prompt: 'find things' } })
    assert.deepEqual(r, {}, `${tool_name} should pass through untouched`)
  }
})

test('non-Explore agents are never downgraded — emits {}', () => {
  for (const subagent_type of ['general-purpose', 'Plan', 'code-reviewer']) {
    const r = runHook({ tool_input: { subagent_type, prompt: 'find all the things' } })
    assert.deepEqual(r, {}, `${subagent_type} should stay on opus`)
  }
})

test('hard keyword inside Explore stays on opus — emits {}', () => {
  const r = runHook({
    tool_input: {
      subagent_type: 'Explore',
      prompt: 'find where we implement the auth refactor',
    },
  })
  assert.deepEqual(r, {})
})

test('malformed stdin never breaks the call — emits {}', () => {
  const r = runHook({ stdin: 'not json {{{' })
  assert.deepEqual(r, {})
  const empty = runHook({ stdin: '' })
  assert.deepEqual(empty, {})
})

test('hook never escalates: only ever rewrites to haiku/sonnet, never back to opus', () => {
  // A non-downgrade must yield {} (so the call inherits the session default),
  // never an updatedInput that forces opus. This is the no-escalation invariant.
  const cases = [
    { subagent_type: 'general-purpose', prompt: 'implement X' },
    { subagent_type: 'Explore', prompt: 'design a new architecture' },
    { subagent_type: 'Explore', prompt: 'a'.repeat(6000) }, // long → uncertain
  ]
  for (const tool_input of cases) {
    const r = runHook({ tool_input })
    assert.deepEqual(r, {}, 'uncertain cases must pass through, not force a model')
  }
})

test('every routed decision is appended to the shared log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-hook-'))
  const log = join(dir, 'log.jsonl')
  try {
    runHook({
      tool_input: { subagent_type: 'Explore', prompt: 'find foo' },
      env: { SMART_DISPATCH_LOG: log },
    })
    const lines = readFileSync(log, 'utf8').trim().split('\n')
    assert.ok(lines.length >= 1, 'at least one decision logged')
    const entry = JSON.parse(lines[lines.length - 1])
    assert.ok(['ts', 'tier', 'confidence', 'model'].every((k) => k in entry))
    assert.ok(['haiku', 'sonnet', 'opus'].includes(entry.model))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a logging failure never breaks the tool call', () => {
  // Point the log at an unwritable path; the hook must still emit its routing
  // decision (or {}) — logging is best-effort.
  const r = runHook({
    tool_input: { subagent_type: 'Explore', prompt: 'find foo' },
    env: { SMART_DISPATCH_LOG: '/no/such/dir/cannot/write/log.jsonl' },
  })
  assert.equal(r.hookSpecificOutput.updatedInput.model, 'haiku')
})
