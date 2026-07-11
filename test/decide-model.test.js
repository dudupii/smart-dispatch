import { test } from 'node:test'
import * as assert from 'node:assert'
import { decideModel } from '../src/decide-model.js'

// Quality-first defaults — everything uncertain goes to opus.
test('Hard task → opus', () => {
  assert.equal(decideModel({ tier: 'Hard', confidence: 0.99 }).model, 'opus')
})
test('Unknown tier → opus', () => {
  assert.equal(decideModel({ tier: 'Unknown', confidence: 0.99 }).model, 'opus')
})
test('missing tier → opus (safe default)', () => {
  assert.equal(decideModel({ confidence: 0.9 }).model, 'opus')
})

// Confident downgrades.
test('Trivial + confident → haiku', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.9 }).model, 'haiku')
})
test('Routine + confident → sonnet', () => {
  assert.equal(decideModel({ tier: 'Routine', confidence: 0.85 }).model, 'sonnet')
})

// The quality guarantee: low confidence never downgrades.
test('Trivial + not confident → opus', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.7 }).model, 'opus')
})
test('Routine + not confident → opus', () => {
  assert.equal(decideModel({ tier: 'Routine', confidence: 0.5 }).model, 'opus')
})
test('boundary: confidence exactly 0.8 downgrades', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.8 }).model, 'haiku')
})

// User override short-circuits everything.
test('user override wins over tier', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, userOverride: 'haiku' }).model,
    'haiku'
  )
})

// Budget mode — the ONLY allowed downward override of opus.
test('budget low downgrades opus → sonnet', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.05 }).model,
    'sonnet'
  )
})
test('budget ok keeps opus', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.5 }).model,
    'opus'
  )
})
