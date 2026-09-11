import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeDispatch } from '../src/dispatch-pipeline.js'
import { hashPrompt } from '../src/escalation.js'

const NOW = Date.parse('2026-09-11T12:00:00Z')
const CALL = { subagentType: 'Explore', prompt: 'find all usages of X', description: 'find', host: 'claude-code' }

function run(call, { entries = [], config = {}, logged = [] } = {}) {
  return {
    decision: routeDispatch(call, {
      entries,
      nowMs: NOW,
      config,
      logEntry: (e) => logged.push(e),
    }),
    logged,
  }
}

test('explicit model = user override: decision passes through, nothing logged', () => {
  const { decision, logged } = run({ ...CALL, explicitModel: 'sonnet' })
  assert.deepEqual(decision, { model: 'sonnet', rewrite: null, downgraded: false, escalatedFrom: null, reason: 'user override' })
  assert.equal(logged.length, 0)
})

test('confident read-only downgrade: rewrite to the registry leader of the tier', () => {
  const { decision, logged } = run(CALL)
  assert.equal(decision.model, 'light')
  assert.equal(decision.rewrite, 'light')
  assert.equal(decision.downgraded, true)
  assert.equal(logged.length, 1)
  assert.equal(logged[0].model, 'light')
  assert.equal(logged[0].agent, 'Explore')
  assert.equal(logged[0].host, 'claude-code')
  assert.ok(logged[0].hash)
})

test('hard/uncertain task: model resolves for the log, but no rewrite (inherit session default)', () => {
  const { decision, logged } = run({ subagentType: 'Explore', prompt: 'design a caching layer', description: '', host: 'pi' })
  assert.equal(decision.model, 'heavy')
  assert.equal(decision.rewrite, null)
  assert.equal(decision.downgraded, false)
  assert.equal(logged[0].model, 'heavy')
  assert.equal(logged[0].host, 'pi')
})

test('retry of a downgraded task: escalate — heavy in the log, escalatedFrom set, no rewrite', () => {
  const hash = hashPrompt({ prompt: CALL.prompt, description: CALL.description })
  // Legacy-vocabulary entry: pre-v0.5.0 logs say haiku — must still match.
  const entries = [{ ts: '2026-09-11T11:55:00Z', model: 'haiku', hash }]
  const { decision, logged } = run(CALL, { entries })
  assert.equal(decision.model, 'heavy')
  assert.equal(decision.rewrite, null)
  assert.equal(decision.escalatedFrom, 'haiku')
  assert.equal(logged[0].tier, 'Retry')
  assert.equal(logged[0].escalatedFrom, 'haiku')
})

test('escalation disabled via config: normal downgrade resumes', () => {
  const hash = hashPrompt({ prompt: CALL.prompt, description: CALL.description })
  const entries = [{ ts: '2026-09-11T11:55:00Z', model: 'haiku', hash }]
  const { decision } = run(CALL, { entries, config: { escalation: { enabled: false } } })
  assert.equal(decision.rewrite, 'light')
})

test('agentOverrides: fixed slot wins over heuristics, canonicalized, always rewritten', () => {
  const config = { agentOverrides: { 'my-finder': 'haiku' } } // legacy alias, un-normalized
  const { decision, logged } = run(
    { subagentType: 'my-finder', prompt: 'architect a distributed system', description: '', host: 'codex' },
    { config },
  )
  assert.equal(decision.model, 'light', 'legacy alias canonicalized for the log')
  assert.equal(decision.rewrite, 'light', 'a configured fixed model is written explicitly, even heavy')
  assert.equal(logged[0].tier, 'Override')
  assert.equal(logged[0].model, 'light')
})

test('agentOverrides: concrete model id passes through verbatim (outside the vocabulary)', () => {
  const config = { agentOverrides: { 'my-finder': 'claude-opus-4-1' } }
  const { decision } = run(
    { subagentType: 'my-finder', prompt: 'architect a distributed system', description: '', host: 'claude-code' },
    { config },
  )
  assert.equal(decision.model, 'claude-opus-4-1')
  assert.equal(decision.rewrite, 'claude-opus-4-1')
})

test('agentOverrides: "never" skips routing entirely — no decision log', () => {
  const config = { agentOverrides: { Explore: 'never' } }
  const { decision, logged } = run(CALL, { config })
  assert.equal(decision.rewrite, null)
  assert.equal(logged.length, 0)
})

test('threshold config flows through: higher threshold keeps the task on heavy', () => {
  const { decision } = run(CALL, { config: { downgradeThreshold: 0.9 } })
  assert.equal(decision.rewrite, null)
  assert.equal(decision.model, 'heavy')
})
