import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyHeuristic } from '../src/classify-heuristic.js'
import { decideModel } from '../src/decide-model.js'

// Helper: full pipeline as the hook uses it — heuristic tier/confidence → policy.
function route(call) {
  const h = classifyHeuristic(call)
  if (h.skip) return { skip: true }
  return decideModel({ tier: h.tier, confidence: h.confidence })
}

test('explicit model is respected as an override (never routed)', () => {
  const r = classifyHeuristic({ subagent_type: 'Explore', prompt: 'find foo', model: 'opus' })
  assert.equal(r.skip, true)
})

test('non-Explore agents are never downgraded', () => {
  for (const t of ['general-purpose', 'Plan', 'code-reviewer', 'custom']) {
    const r = route({ subagent_type: t, prompt: 'find all the things' })
    assert.equal(r.skip || r.model, r.skip || 'opus')
    if (!r.skip) assert.equal(r.model, 'opus', `${t} should stay on opus`)
  }
})

test('short read-only search → haiku', () => {
  const r = route({ subagent_type: 'Explore', prompt: 'find all usages of decideModel', description: 'search' })
  assert.equal(r.model, 'haiku')
  assert.equal(r.downgraded, true)
})

test('hard keyword inside Explore → stays on opus', () => {
  const r = route({ subagent_type: 'Explore', prompt: 'find where we implement the auth refactor' })
  assert.equal(r.model, 'opus')
  assert.equal(r.downgraded, false)
})

test('medium Explore with no hard signal → sonnet', () => {
  const r = route({ subagent_type: 'Explore', prompt: 'a'.repeat(2000) + ' look around the module' })
  assert.equal(r.model, 'sonnet')
  assert.equal(r.downgraded, true)
})

test('very long Explore → stays on opus (uncertain)', () => {
  const r = route({ subagent_type: 'Explore', prompt: 'a'.repeat(5000) })
  assert.equal(r.model, 'opus')
  assert.equal(r.downgraded, false)
})

test('invariant: the hook never escalates or touches a non-downgrade case', () => {
  // Anything that doesn't confidently downgrade must yield opus, not sonnet/haiku.
  const cases = [
    { subagent_type: 'general-purpose', prompt: 'implement feature X' },
    { subagent_type: 'Explore', prompt: 'design a new architecture' },
    { subagent_type: 'Explore', prompt: 'a'.repeat(6000) },
  ]
  for (const c of cases) {
    const r = route(c)
    assert.equal(r.model, 'opus')
  }
})
