import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODEL_REGISTRY, resolveModel } from '../src/model-registry.js'
import { PRICE_TABLE } from '../src/compute-metrics.js'

test('MODEL_REGISTRY is versioned, dated, and curates the Anthropic lineup', () => {
  assert.ok(MODEL_REGISTRY.version >= 1)
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(MODEL_REGISTRY.asOf), 'asOf is a visible date')
  const pools = MODEL_REGISTRY.providers.anthropic.pools
  for (const tier of ['Trivial', 'Routine', 'Hard', 'Unknown']) {
    assert.ok(Array.isArray(pools[tier]) && pools[tier].length > 0, `${tier} has an ordered pool`)
  }
  // Quality-first anchor: the strongest model leads the Hard/Unknown pools.
  assert.equal(pools.Hard[0], 'opus')
  assert.equal(pools.Unknown[0], 'opus')
})

test('resolveModel returns the curated pool leader per tier', () => {
  assert.equal(resolveModel('Trivial'), 'haiku')
  assert.equal(resolveModel('Routine'), 'sonnet')
  assert.equal(resolveModel('Hard'), 'opus')
  assert.equal(resolveModel('Unknown'), 'opus')
  assert.equal(resolveModel(undefined), 'opus', 'missing tier → safe default')
})

test('resolveModel: unknown provider → null (caller falls back to policy)', () => {
  assert.equal(resolveModel('Hard', { provider: 'openai' }), null)
})

test('registry costs stay locked to the price table (drift guard)', () => {
  for (const [model, cost] of Object.entries(PRICE_TABLE.relative)) {
    assert.equal(MODEL_REGISTRY.models[model].relativeCost, cost, `${model} cost drift vs PRICE_TABLE`)
  }
})

test('prefer reorders only within the tier pool, never below the leader on that dimension', () => {
  // Fixture: a provider where a cheaper model beats the leader on longContext.
  const fixture = {
    version: 1,
    asOf: '2026-09-11',
    models: {
      strong: { relativeCost: 1.0, strengths: { longContext: 3 } },
      wide: { relativeCost: 0.3, strengths: { longContext: 5 } },
      weak: { relativeCost: 0.1, strengths: { longContext: 1 } },
    },
    providers: {
      fixture: { pools: { Trivial: ['weak'], Routine: ['strong', 'wide'], Hard: ['strong'], Unknown: ['strong'] } },
    },
  }
  const opts = { provider: 'fixture', registry: fixture }
  // wide ≥ strong on longContext → the tiebreaker may pick wide (cheaper, fit)
  assert.equal(resolveModel('Routine', { ...opts, prefer: 'longContext' }), 'wide')
  // without the preference, curated order (quality anchor) stands
  assert.equal(resolveModel('Routine', opts), 'strong')
  // a preference the leader already wins keeps the leader
  assert.equal(resolveModel('Hard', { ...opts, prefer: 'longContext' }), 'strong')
})

test('prefer with unknown dimension or missing strengths → leader, never throws', () => {
  assert.equal(resolveModel('Hard', { prefer: 'nonexistent' }), 'opus')
})
