import { test } from 'node:test'
import * as assert from 'node:assert'
import { computeMetrics, PRICE_TABLE } from '../src/compute-metrics.js'

test('empty → null metrics, count 0', () => {
  assert.deepEqual(computeMetrics([]), { falseDowngradeRate: null, savingsRate: null, count: 0 })
})

test('PRICE_TABLE is versioned, dated, and covers all three models', () => {
  assert.ok(PRICE_TABLE.version >= 1)
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(PRICE_TABLE.asOf), 'asOf is a visible date')
  for (const m of ['haiku', 'sonnet', 'opus']) {
    assert.ok(Number.isFinite(PRICE_TABLE.relative[m]), `${m} has a relative weight`)
  }
})

test('relativeCost override changes savings, never falseDowngradeRate', () => {
  const outcomes = [{ trueTier: 'Trivial', chosenModel: 'haiku' }]
  const stock = computeMetrics(outcomes)
  const custom = computeMetrics(outcomes, { relativeCost: { haiku: 0.05, sonnet: 0.3, opus: 1.0 } })
  assert.equal(stock.savingsRate, 0.9)
  assert.equal(custom.savingsRate, 0.95)
  assert.equal(custom.falseDowngradeRate, stock.falseDowngradeRate)
})
test('all Hard on opus → zero false-downgrade, zero savings', () => {
  const m = computeMetrics([
    { trueTier: 'Hard', chosenModel: 'opus' },
    { trueTier: 'Hard', chosenModel: 'opus' },
  ])
  assert.equal(m.falseDowngradeRate, 0)
  assert.equal(m.savingsRate, 0)
})
test('Hard routed to haiku → false-downgrade rate 1', () => {
  const m = computeMetrics([{ trueTier: 'Hard', chosenModel: 'haiku' }])
  assert.equal(m.falseDowngradeRate, 1)
})
test('non-Hard tasks do not affect false-downgrade rate', () => {
  const m = computeMetrics([
    { trueTier: 'Trivial', chosenModel: 'haiku' },
    { trueTier: 'Routine', chosenModel: 'sonnet' },
  ])
  assert.equal(m.falseDowngradeRate, 0)
})
test('no Hard tasks → false-downgrade rate 0 (vacuously)', () => {
  const m = computeMetrics([{ trueTier: 'Trivial', chosenModel: 'haiku' }])
  assert.equal(m.falseDowngradeRate, 0)
})
test('savings rate computed vs all-opus baseline', () => {
  const m = computeMetrics([
    { trueTier: 'Trivial', chosenModel: 'haiku' }, // 0.1
    { trueTier: 'Hard', chosenModel: 'opus' },      // 1.0
  ])
  // actual 1.1, baseline 2.0 → savings 0.45
  assert.equal(m.savingsRate, 0.45)
})
