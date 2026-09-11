import { test } from 'node:test'
import * as assert from 'node:assert'
import { computeMetrics, PRICE_TABLE } from '../src/compute-metrics.js'

test('empty → null metrics, count 0', () => {
  assert.deepEqual(computeMetrics([]), { falseDowngradeRate: null, savingsRate: null, count: 0 })
})

test('PRICE_TABLE is versioned, dated, and covers all three slots', () => {
  assert.ok(PRICE_TABLE.version >= 1)
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(PRICE_TABLE.asOf), 'asOf is a visible date')
  for (const m of ['light', 'mid', 'heavy']) {
    assert.ok(Number.isFinite(PRICE_TABLE.relative[m]), `${m} has a relative weight`)
  }
})

test('relativeCost override changes savings, never falseDowngradeRate', () => {
  const outcomes = [{ trueTier: 'Trivial', chosenModel: 'light' }]
  const stock = computeMetrics(outcomes)
  const custom = computeMetrics(outcomes, { relativeCost: { light: 0.05, mid: 0.3, heavy: 1.0 } })
  assert.equal(stock.savingsRate, 0.9)
  assert.equal(custom.savingsRate, 0.95)
  assert.equal(custom.falseDowngradeRate, stock.falseDowngradeRate)
})
test('all Hard on heavy → zero false-downgrade, zero savings', () => {
  const m = computeMetrics([
    { trueTier: 'Hard', chosenModel: 'heavy' },
    { trueTier: 'Hard', chosenModel: 'heavy' },
  ])
  assert.equal(m.falseDowngradeRate, 0)
  assert.equal(m.savingsRate, 0)
})
test('Hard routed to light → false-downgrade rate 1', () => {
  const m = computeMetrics([{ trueTier: 'Hard', chosenModel: 'light' }])
  assert.equal(m.falseDowngradeRate, 1)
})
test('non-Hard tasks do not affect false-downgrade rate', () => {
  const m = computeMetrics([
    { trueTier: 'Trivial', chosenModel: 'light' },
    { trueTier: 'Routine', chosenModel: 'mid' },
  ])
  assert.equal(m.falseDowngradeRate, 0)
})
test('no Hard tasks → false-downgrade rate 0 (vacuously)', () => {
  const m = computeMetrics([{ trueTier: 'Trivial', chosenModel: 'light' }])
  assert.equal(m.falseDowngradeRate, 0)
})
test('savings rate computed vs all-heavy baseline', () => {
  const m = computeMetrics([
    { trueTier: 'Trivial', chosenModel: 'light' }, // 0.1
    { trueTier: 'Hard', chosenModel: 'heavy' },    // 1.0
  ])
  // actual 1.1, baseline 2.0 → savings 0.45
  assert.equal(m.savingsRate, 0.45)
})
test('legacy-vocabulary outcomes are canonicalized internally (pre-v0.5.0 logs)', () => {
  const m = computeMetrics([
    { trueTier: 'Trivial', chosenModel: 'haiku' }, // → light, 0.1
    { trueTier: 'Hard', chosenModel: 'opus' },     // → heavy, 1.0 — NOT an unknown-cost 1.0 guess
  ])
  assert.equal(m.savingsRate, 0.45)
  assert.equal(m.falseDowngradeRate, 0)
})
