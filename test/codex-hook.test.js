// Integration test for the Codex adapter binary — same pattern as
// test/hook.test.js: spawn the REAL hook script with host-shaped payloads
// (both documented spawn schemas) and assert on the JSON it writes.
//
// Codex's own CLI could not be live-spiked from this environment (network);
// the fixtures below encode the documented contract:
//   V2 (metadata hidden):  { task_name, message, fork_turns }
//   metadata-visible:      + { agent_type, model, reasoning_effort }

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK = join(__dirname, '..', 'codex', 'hooks', 'route-codex.mjs')

const tmpRoot = mkdtempSync(join(tmpdir(), 'sd-codex-test-'))
let runCount = 0
after(() => rmSync(tmpRoot, { recursive: true, force: true }))

function runHook({ tool_name = 'spawn_agent', tool_input = {}, env = {}, stdin } = {}) {
  const payload = stdin ?? JSON.stringify({ tool_name, tool_input })
  const res = spawnSync('node', [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: {
      ...process.env,
      SMART_DISPATCH_LOG: join(tmpRoot, `log-${++runCount}.jsonl`),
      ...env,
    },
  })
  assert.equal(res.status, 0, `hook exited ${res.status}\nstderr: ${res.stderr}`)
  const out = res.stdout.trim()
  return out === '' ? {} : JSON.parse(out)
}

function lastLog(env) {
  const files = env.SMART_DISPATCH_LOG ? [env.SMART_DISPATCH_LOG] : []
  const log = files[0] || join(tmpRoot, `log-${runCount}.jsonl`)
  return JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop())
}

// ── veto mode (V2 default: no model metadata on the spawn) ───────────────────

test('confident trivial spawn is denied with the pinned tier agent to re-dispatch to', () => {
  const r = runHook({
    tool_input: { task_name: 'find-json', message: 'Search the repo for all JSON files and list their paths', fork_turns: false },
  })
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(r.hookSpecificOutput.reason, /smart-dispatch-explorer/)
})

test('hard spawn passes untouched — emits {}', () => {
  const r = runHook({
    tool_input: { task_name: 'design', message: 'Design a caching layer for the dispatch pipeline and implement it', fork_turns: false },
  })
  assert.deepEqual(r, {})
})

test('veto-mode decision is logged with host codex', () => {
  const env = {}
  runHook({
    tool_input: { task_name: 'find-json', message: 'Search the repo for all JSON files and list their paths' },
    env,
  })
  // runHook used its own temp log (runCount); read it back
  const log = join(tmpRoot, `log-${runCount}.jsonl`)
  const entry = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop())
  assert.equal(entry.host, 'codex')
  assert.equal(entry.model, 'haiku')
})

// ── rewrite mode (writable model field + configured tier→model ids) ─────────

test('inherit spawn (no model named) + configured mapping is rewritten in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-codex-cfg-'))
  const config = join(dir, 'config.json')
  writeFileSync(config, JSON.stringify({ codex: { models: { haiku: 'gpt-5-mini-codex' } } }))
  try {
    const r = runHook({
      tool_input: {
        agent_type: 'general-purpose',
        task_name: 'find-json',
        message: 'Search the repo for all JSON files and list their paths',
        reasoning_effort: 'high',
      },
      env: { SMART_DISPATCH_CONFIG: config },
    })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'allow')
    assert.equal(r.hookSpecificOutput.updatedInput.model, 'gpt-5-mini-codex')
    assert.equal(r.hookSpecificOutput.updatedInput.reasoning_effort, 'high', 'only the model is added')
    assert.equal(r.hookSpecificOutput.updatedInput.task_name, 'find-json', 'rest of the spawn preserved')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inherit spawn but NO configured mapping falls back to veto, never writes a bogus id', () => {
  const r = runHook({
    tool_input: {
      agent_type: 'general-purpose',
      task_name: 'find-json',
      message: 'Search the repo for all JSON files and list their paths',
    },
  })
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
})

// ── shared invariants ─────────────────────────────────────────────────────────

test('explicit model on the spawn = user override — never routed', () => {
  // explicitModel short-circuits inside the pipeline; the adapter only acts
  // on downgraded decisions, so an override spawn passes through.
  const r = runHook({
    tool_input: {
      task_name: 'find-json',
      message: 'Search the repo for all JSON files and list their paths',
      model: 'gpt-4.1-nano', // user pinned a cheap model explicitly
    },
  })
  assert.deepEqual(r, {})
})

test('non-spawn tools and malformed stdin are no-ops', () => {
  assert.deepEqual(runHook({ tool_name: 'shell', tool_input: { command: 'ls' } }), {})
  assert.deepEqual(runHook({ stdin: 'not json {{{' }), {})
})

test('dry-run logs the decision but never denies nor rewrites', () => {
  const r = runHook({
    tool_input: { task_name: 'find-json', message: 'Search the repo for all JSON files and list their paths' },
    env: { SMART_DISPATCH_DRY: '1' },
  })
  assert.deepEqual(r, {})
})
