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

test('non-Explore agents outside general-purpose are never downgraded', () => {
  for (const t of ['Plan', 'code-reviewer', 'custom', 'Explore-writer']) {
    const r = route({ subagent_type: t, prompt: 'find all the things' })
    assert.equal(r.skip || r.model, r.skip || 'opus')
    if (!r.skip) assert.equal(r.model, 'opus', `${t} should stay on opus`)
  }
})

// ── general-purpose gate (v0.3 coverage widening) ────────────────────────────
// The gate: short prompts + unambiguous read-only/mechanical verb, no hard
// signal. These adversarial cases ARE the eval gate for this surface — extend
// them before extending coverage.

test('general-purpose: short read-only search → haiku', () => {
  const r = route({ subagent_type: 'general-purpose', prompt: 'find all TODO comments in src/' })
  assert.equal(r.model, 'haiku')
  assert.equal(r.downgraded, true)
})

test('general-purpose: mechanical verb → sonnet', () => {
  const r = route({ subagent_type: 'general-purpose', prompt: 'summarize the changes in the diff and report counts' })
  assert.equal(r.model, 'sonnet')
  assert.equal(r.downgraded, true)
})

test('general-purpose ADVERSARIAL: search + hard verb → stays on opus', () => {
  const traps = [
    'find the root cause of the memory leak and fix it',
    'search the codebase and rewrite all usages of the old API', // 'rewrite' ⊃ 'write'
    'find where the auth flow is implemented and refactor it',
    'locate the bug and debug why the hook fires twice',
  ]
  for (const prompt of traps) {
    const r = route({ subagent_type: 'general-purpose', prompt })
    assert.equal(r.model, 'opus', `trap must stay on opus: "${prompt.slice(0, 40)}…"`)
  }
})

test('general-purpose ADVERSARIAL: long or vague prompts → opus', () => {
  const vague = [
    'help with this codebase', // no safe verb
    'look into it and figure out what is going on then report back with options', // long, mixed intent
    'a'.repeat(2000) + ' find things', // past the length gate
  ]
  for (const prompt of vague) {
    const r = route({ subagent_type: 'general-purpose', prompt })
    assert.equal(r.model, 'opus')
  }
})

test('hard keywords now protect every agent type (checked before the type gates)', () => {
  for (const t of ['Plan', 'code-reviewer', 'custom']) {
    const h = classifyHeuristic({ subagent_type: t, prompt: 'review and fix the failing tests' })
    assert.equal(h.tier, 'Hard', `${t}: hard signal should classify as Hard (still opus)`)
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
