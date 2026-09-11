import { test } from 'node:test'
import * as assert from 'node:assert'
import { decideModel } from '../src/decide-model.js'

// Quality-first defaults — everything uncertain goes to heavy.
test('Hard task → heavy', () => {
  assert.equal(decideModel({ tier: 'Hard', confidence: 0.99 }).model, 'heavy')
})
test('Unknown tier → heavy', () => {
  assert.equal(decideModel({ tier: 'Unknown', confidence: 0.99 }).model, 'heavy')
})
test('missing tier → heavy (safe default)', () => {
  assert.equal(decideModel({ confidence: 0.9 }).model, 'heavy')
})

// Confident downgrades.
test('Trivial + confident → light', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.9 }).model, 'light')
})
test('Routine + confident → mid', () => {
  assert.equal(decideModel({ tier: 'Routine', confidence: 0.85 }).model, 'mid')
})

// The quality guarantee: low confidence never downgrades.
test('Trivial + not confident → heavy', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.7 }).model, 'heavy')
})
test('Routine + not confident → heavy', () => {
  assert.equal(decideModel({ tier: 'Routine', confidence: 0.5 }).model, 'heavy')
})
test('boundary: confidence exactly 0.8 downgrades', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.8 }).model, 'light')
})

// User override short-circuits everything — verbatim, outside the slot
// vocabulary (concrete model ids pass through unvalidated).
test('user override wins over tier (any string, unvalidated)', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, userOverride: 'claude-opus-4-1' }).model,
    'claude-opus-4-1'
  )
})

// Budget mode — the ONLY allowed downward override of heavy.
test('budget low downgrades heavy → mid', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.05 }).model,
    'mid'
  )
})
test('budget ok keeps heavy', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.5 }).model,
    'heavy'
  )
})

// Confidence must be a valid non-negative number; anything else is treated
// as "not confident" so we never downgrade on garbage input.
test('NaN confidence → heavy (treated as not confident)', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: NaN }).model, 'heavy')
})
test('negative confidence → heavy (treated as not confident)', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: -0.5 }).model, 'heavy')
})

// Budget mode never escalates a confident downgrade back up — it only steps
// heavy DOWN. A confident light/mid choice survives a low budget.
test('confident downgrade survives low budget (no escalation)', () => {
  // Trivial + confident → light; low budget must NOT escalate it back up.
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.9, budgetRemaining: 0.01 }).model, 'light')
})

// Config-injected thresholds (src/config.js) — same policy, user-tuned knobs.
// Defaults must behave exactly like the exported constants.
test('injected downgradeThreshold moves the bar for leaving heavy', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.7 }, { downgradeThreshold: 0.6 }).model, 'light')
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.7 }).model, 'heavy')
})

test('injected budgetFloor widens/narrows the heavy step-down zone', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.05 }, { budgetFloor: 0.01 }).model,
    'heavy',
  )
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.5 }, { budgetFloor: 0.6 }).model,
    'mid',
  )
})
