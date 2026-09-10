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
  assert.equal(decision.model, 'haiku')
  assert.equal(decision.rewrite, 'haiku')
  assert.equal(decision.downgraded, true)
  assert.equal(logged.length, 1)
  assert.equal(logged[0].model, 'haiku')
  assert.equal(logged[0].agent, 'Explore')
  assert.equal(logged[0].host, 'claude-code')
  assert.ok(logged[0].hash)
})

test('hard/uncertain task: model resolves for the log, but no rewrite (inherit session default)', () => {
  const { decision, logged } = run({ subagentType: 'Explore', prompt: 'design a caching layer', description: '', host: 'pi' })
  assert.equal(decision.model, 'opus')
  assert.equal(decision.rewrite, null)
  assert.equal(decision.downgraded, false)
  assert.equal(logged[0].model, 'opus')
  assert.equal(logged[0].host, 'pi')
})

test('retry of a downgraded task: escalate — opus in the log, escalatedFrom set, no rewrite', () => {
  const hash = hashPrompt({ prompt: CALL.prompt, description: CALL.description })
  const entries = [{ ts: '2026-09-11T11:55:00Z', model: 'haiku', hash }]
  const { decision, logged } = run(CALL, { entries })
  assert.equal(decision.model, 'opus')
  assert.equal(decision.rewrite, null)
  assert.equal(decision.escalatedFrom, 'haiku')
  assert.equal(logged[0].tier, 'Retry')
  assert.equal(logged[0].escalatedFrom, 'haiku')
})

test('escalation disabled via config: normal downgrade resumes', () => {
  const hash = hashPrompt({ prompt: CALL.prompt, description: CALL.description })
  const entries = [{ ts: '2026-09-11T11:55:00Z', model: 'haiku', hash }]
  const { decision } = run(CALL, { entries, config: { escalation: { enabled: false } } })
  assert.equal(decision.rewrite, 'haiku')
})

test('agentOverrides: fixed model wins over heuristics and is always rewritten', () => {
  const config = { agentOverrides: { 'my-finder': 'haiku' } }
  const { decision, logged } = run(
    { subagentType: 'my-finder', prompt: 'architect a distributed system', description: '', host: 'codex' },
    { config },
  )
  assert.equal(decision.model, 'haiku')
  assert.equal(decision.rewrite, 'haiku', 'a configured fixed model is written explicitly, even opus')
  assert.equal(logged[0].tier, 'Override')
})

test('agentOverrides: "never" skips routing entirely — no decision log', () => {
  const config = { agentOverrides: { Explore: 'never' } }
  const { decision, logged } = run(CALL, { config })
  assert.equal(decision.rewrite, null)
  assert.equal(logged.length, 0)
})

test('threshold config flows through: higher threshold keeps the task on opus', () => {
  const { decision } = run(CALL, { config: { downgradeThreshold: 0.9 } })
  assert.equal(decision.rewrite, null)
  assert.equal(decision.model, 'opus')
})
